const POSPage = {
  cart: [],
  discount: 0,
  discountApprover: null,
  discountManagerPin: null,
  selectedCategory: null,

  _menuHighlightSettings() {
    const raw = this.app?.settings?.customization?.menu_highlight_settings || {};
    return {
      tabs: {
        available_today: { pos: raw.tabs?.available_today?.pos !== false },
        new_arrival: { pos: raw.tabs?.new_arrival?.pos !== false },
        best_seller: { pos: raw.tabs?.best_seller?.pos !== false },
        today_special: { pos: raw.tabs?.today_special?.pos !== false }
      }
    };
  },

  getMenuTabCounts() {
    if (this._menuTabCountCache) return this._menuTabCountCache;
    const today = new Date().toLocaleDateString('en-CA');
    const products = this.products || [];
    return {
      __available_today: products.filter((p) => Number(p.available_today) === 1).length,
      __new_arrival: products.filter((p) => Number(p.is_new_arrival) === 1
        && (!p.new_arrival_until || p.new_arrival_until >= today)).length,
      __best_seller: products.filter((p) => Number(p.is_best_seller) === 1).length,
      __today_special: products.filter((p) => p.promo_active).length
    };
  },

  _buildHighlightTabsHtml(activeCat = '') {
    const cfg = this._menuHighlightSettings();
    const counts = this.getMenuTabCounts();
    const defs = [
      { key: 'available_today', cat: '__available_today', label: 'Available Today', color: '#2dd4bf' },
      { key: 'new_arrival', cat: '__new_arrival', label: 'New Arrival', color: '#38bdf8' },
      { key: 'best_seller', cat: '__best_seller', label: 'Best Seller', color: '#fbbf24' },
      { key: 'today_special', cat: '__today_special', label: "Today's Special", color: '#ef4444', sale: true }
    ];
    return defs.filter((d) => cfg.tabs[d.key]?.pos !== false).map((d) => {
      const cnt = counts[d.cat] || 0;
      const badge = cnt ? `<span class="menu-tab-count${d.sale ? ' sale' : ''}">${cnt}</span>` : '';
      const cls = d.sale ? 'cat-tab cat-tab-sale' : 'cat-tab';
      const active = activeCat === d.cat ? ' active' : '';
      return `<button class="${cls}${active}" data-cat="${d.cat}" style="border-color:${d.color}">${d.label}${badge}</button>`;
    }).join('');
  },

  _unwrapRpcList(res) {
    if (Array.isArray(res)) return res;
    if (res?.success === false) return [];
    if (Array.isArray(res?.data)) return res.data;
    return [];
  },

  /** Keep last good catalog when RPC fails or returns empty. */
  _applyRpcList(res, fallback = []) {
    if (res?.success === false) return fallback;
    const list = this._unwrapRpcList(res);
    if (!list.length && fallback.length) return fallback;
    return list.length ? list : fallback;
  },

  _normalizeOpenShift(shiftRes) {
    if (shiftRes?.success === false) {
      return (this._pendingLocalShift?.id ? this._pendingLocalShift : null)
        || (this.openShift?.id ? this.openShift : null);
    }
    const data = shiftRes?.data ?? (shiftRes?.id ? shiftRes : null);
    if (!data) return this._pendingLocalShift?.id ? this._pendingLocalShift : null;
    if (data.queued && !data.id) return this._pendingLocalShift?.id ? this._pendingLocalShift : null;
    if (data.id) {
      this._pendingLocalShift = null;
      return data;
    }
    return null;
  },

  _catalogSig(products, categories, combos) {
    const p = products || [];
    const c = categories || [];
    const k = combos || [];
    const p0 = p[0]?.id ?? '';
    const pN = p[p.length - 1]?.id ?? '';
    return `${p.length}:${c.length}:${k.length}:${p0}:${pN}`;
  },

  _applyCatalogFromRpc(catRes, prodRes, comboRes, branchId) {
    const prevCats = this.categories || [];
    const prevProds = this.products || [];
    const prevCombos = this.combos || [];
    const nextCats = this._applyRpcList(catRes, prevCats);
    const nextProds = Utils.restorePosCatalogProducts(this._applyRpcList(prodRes, prevProds));
    let nextCombos = prevCombos;
    if (comboRes?.success !== false) {
      const raw = comboRes?.data ?? (Array.isArray(comboRes) ? comboRes : []);
      nextCombos = this.filterActiveCombos(raw);
    }
    if (!nextProds.length) return false;
    const same = this._catalogSig(prevProds, prevCats, prevCombos)
      === this._catalogSig(nextProds, nextCats, nextCombos)
      && document.getElementById('pos-grid')?.querySelector('.product-card');
    this.categories = nextCats;
    this.products = nextProds;
    this.combos = nextCombos;
    if (same) {
      if (branchId != null) this.savePosCatalogSnapshot(branchId);
      return true;
    }
    this._menuTabCountCache = null;
    this._invalidateProductGridCache();
    this.rebuildProductLookups();
    this.ensureDefaultCategory();
    const tabs = document.getElementById('pos-categories');
    if (tabs) this.renderCategoryTabs(this.selectedCategory || '');
    this.renderProducts(document.getElementById('pos-search')?.value || '');
    this.renderCart?.();
    if (branchId != null) this.savePosCatalogSnapshot(branchId);
    return true;
  },

  _productHasOptionDetail(product) {
    return !!(product?.options?.length || product?.extras?.length || product?.removals?.length);
  },

  async ensureFullProduct(product) {
    if (!product?.id) return product;
    if (this._productHasOptionDetail(product)) return product;
    const need = product._hasOptions || product.requires_options;
    if (!need) return product;
    if (this._fullProductInflight?.[product.id]) return this._fullProductInflight[product.id];
    const work = (async () => {
      try {
        const r = await API.getProduct(product.id);
        if (r?.success && r.data) {
          const idx = this.products.findIndex((p) => p.id == product.id);
          if (idx >= 0) this.products[idx] = { ...this.products[idx], ...r.data };
          else this.products.push(r.data);
          this.rebuildProductLookups();
          return this.products.find((p) => p.id == product.id) || r.data;
        }
      } catch (_) { /* offline — use slim product */ }
      return product;
    })();
    this._fullProductInflight = this._fullProductInflight || {};
    this._fullProductInflight[product.id] = work;
    try {
      return await work;
    } finally {
      delete this._fullProductInflight[product.id];
    }
  },

  prefetchVisibleProductOptions() {
    const list = this._productsForCategory(this.selectedCategory || this.defaultCategoryKey())
      || this.products || [];
    const missing = list.filter((p) =>
      (p._hasOptions || p.requires_options) && !this._productHasOptionDetail(p));
    missing.slice(0, 16).forEach((p) => this.ensureFullProduct(p).catch(() => {}));
  },

  _highlightTabEnabled(catKey) {
    const cfg = this._menuHighlightSettings();
    const map = {
      __available_today: 'available_today',
      __new_arrival: 'new_arrival',
      __best_seller: 'best_seller',
      __today_special: 'today_special'
    };
    const settingKey = map[catKey];
    if (!settingKey) return catKey === 'combos';
    return cfg.tabs?.[settingKey]?.pos !== false;
  },

  _resolveCategoryKey(catKey) {
    const key = String(catKey ?? '');
    if (key && key !== '__all') return key;
    return this.defaultCategoryKey();
  },

  _productsForCategory(catKey) {
    const products = this.products || [];
    catKey = this._resolveCategoryKey(catKey);
    if (catKey === 'combos') return [];
    const today = new Date().toLocaleDateString('en-CA');
    if (catKey === '__available_today') return products.filter((p) => Number(p.available_today) === 1);
    if (catKey === '__new_arrival') {
      return products.filter((p) => Number(p.is_new_arrival) === 1
        && (!p.new_arrival_until || p.new_arrival_until >= today));
    }
    if (catKey === '__best_seller') {
      const flagged = products.filter((p) => Number(p.is_best_seller) === 1);
      return flagged.length
        ? flagged
        : [...products].filter((p) => p.has_recipe || p.item_type === 'restaurant')
          .sort((a, b) => String(b.last_sale_date || '').localeCompare(String(a.last_sale_date || '')))
          .slice(0, 40);
    }
    if (catKey === '__today_special') {
      return this._promoProducts?.length ? this._promoProducts : products.filter((p) => p.promo_active);
    }
    return products.filter((p) => String(p.category_id) === String(catKey));
  },

  _categoryHasProducts(catKey) {
    if (catKey === 'combos') return (this.combos || []).length > 0;
    return this._productsForCategory(catKey).length > 0;
  },

  /** First real menu category — POS opens here by default (never "All"). */
  firstCategoryKey() {
    for (const c of this.categories || []) {
      if (this._categoryHasProducts(String(c.id))) return String(c.id);
    }
    const first = (this.categories || [])[0];
    return first?.id != null ? String(first.id) : null;
  },

  defaultCategoryKey() {
    const first = this.firstCategoryKey();
    if (first) return first;
    const firstCat = (this.categories || [])[0];
    if (firstCat?.id != null) return String(firstCat.id);
    if ((this.combos || []).length) return 'combos';
    const cfg = this._menuHighlightSettings();
    const counts = this.getMenuTabCounts();
    const highlightOrder = [
      ['available_today', '__available_today'],
      ['new_arrival', '__new_arrival'],
      ['best_seller', '__best_seller'],
      ['today_special', '__today_special']
    ];
    for (const [settingKey, catKey] of highlightOrder) {
      if (cfg.tabs?.[settingKey]?.pos === false) continue;
      if ((counts[catKey] || 0) > 0) return catKey;
    }
    if ((this.products || []).length) {
      const withCat = this.products.find((p) => p.category_id != null && p.category_id !== '');
      if (withCat) return String(withCat.category_id);
    }
    return '';
  },

  _isHighlightCategory(catKey) {
    const key = String(catKey || '');
    return key.startsWith('__');
  },

  ensureDefaultCategory() {
    const cur = this.selectedCategory;
    if (cur == null || cur === '' || String(cur) === '__all') {
      this.selectedCategory = this.defaultCategoryKey();
      return;
    }
    if (cur === 'combos') return;
    if (this._isHighlightCategory(cur)) {
      if (this._highlightTabEnabled(cur) && this._categoryHasProducts(cur)) return;
      this.selectedCategory = this.defaultCategoryKey();
      return;
    }
    if ((this.categories || []).some((c) => String(c.id) === String(cur))) return;
    this.selectedCategory = this.defaultCategoryKey();
  },

  setActiveCategoryTab(catKey) {
    const key = String(catKey ?? '');
    document.querySelectorAll('#pos-categories .cat-tab').forEach((t) => {
      t.classList.toggle('active', String(t.dataset.cat) === key);
    });
    const active = document.querySelector('#pos-categories .cat-tab.active');
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  },

  bindCategoryTabsScroll() {
    const el = document.getElementById('pos-categories');
    if (!el || el.dataset.scrollBound === '1') return;
    el.dataset.scrollBound = '1';
    el.addEventListener('wheel', (e) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }, { passive: false });
  },

  _invalidateProductGridCache() {
    this._productGridCache = null;
  },

  _productGridCacheKey(catKey, filter) {
    let stockSig = 0;
    for (const p of (this.products || [])) {
      stockSig += (Number(p.stock_quantity) || 0) + (Number(p.available_meals ?? p.production_capacity) || 0);
    }
    const sig = `${(this.products || []).length}:${stockSig}:${(this.combos || []).length}`;
    return `${catKey}|${filter}|${sig}`;
  },

  renderCategoryTabs(activeCat = '') {
    this.ensureDefaultCategory();
    const cat = this._resolveCategoryKey(activeCat || this.selectedCategory || this.defaultCategoryKey());
    this.selectedCategory = cat;
    const tabs = document.getElementById('pos-categories');
    if (!tabs) return;
    tabs.innerHTML = `
      ${this._buildHighlightTabsHtml(cat)}
      ${this.combos?.length ? `<button class="cat-tab cat-tab-sale ${cat === 'combos' ? 'active' : ''}" data-cat="combos" style="border-color:#ef4444">COMBOS<span class="menu-tab-count sale">${this.combos.length}</span></button>` : ''}
      ${(this.categories || []).map((c) => `<button class="cat-tab ${String(cat) === String(c.id) ? 'active' : ''}" data-cat="${c.id}" style="border-color:${c.color}">
        ${c.image_path ? `<img ${Utils.categoryImageAttr(c)} class="cat-tab-img" alt="">` : ''}${c.name}</button>`).join('')}`;
    this.bindCategoryTabsScroll();
  },
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
  deliveryAddress: null,
  deliveryFee: 0,
  deliverySettings: null,
  deliveryPlace: null,
  deliveryPlaces: [],

  activeDailyTargetAmount() {
    const branchId = this.app?.user?.branch_id;
    const byBranch = this.salesTargets?.by_branch?.[String(branchId)];
    const d = (byBranch && byBranch.daily) || this.salesTargets?.daily;
    if (d != null && typeof d === 'object') {
      if (d.active === false) return 0;
      const amount = Number(d.amount) || 0;
      if (!(amount > 0)) return 0;
      if (d.expires_at) {
        const today = Utils.today?.() || new Date().toLocaleDateString('en-CA');
        if (String(d.expires_at).slice(0, 10) < today) return 0;
      }
      return amount;
    }
    return Number(d) || 0;
  },

  async showTodayTargetModal() {
    const currency = this.app.settings?.currency || 'R';
    const branchId = this.app?.user?.branch_id || null;
    const paint = (progress) => {
      if (!progress) {
        Utils.showModal("Today's Target", '<p class="error-msg">Could not load today\'s target.</p>',
          '<button type="button" class="btn btn-ghost" id="tt-close">Close</button>');
        document.getElementById('tt-close')?.addEventListener('click', () => Utils.hideModal());
        return;
      }
      const dailyActive = progress.daily_active !== false && (Number(progress.daily_target) || 0) > 0;
      const target = Number(progress.daily_target) || 0;
      const achieved = Number(progress.sales_achieved) || 0;
      const remaining = Number(progress.remaining) || 0;
      const pct = Number(progress.percentage) || 0;
      const products = (progress.product_targets_active !== false && Array.isArray(progress.products))
        ? progress.products
        : [];
      const prodTargetQty = Number(progress.product_target_qty) || products.reduce((s, p) => s + (Number(p.target_qty) || 0), 0);
      const prodSoldQty = Number(progress.product_sold_qty) || products.reduce((s, p) => s + (Number(p.sold_qty) || 0), 0);
      const prodTargetVal = Number(progress.product_target_value) || products.reduce((s, p) => s + (Number(p.target_value) || 0), 0);
      const prodSoldVal = Number(progress.product_sold_value) || products.reduce((s, p) => s + (Number(p.sold_value) || 0), 0);
      const expires = progress.product_targets_expires_at
        ? `<div class="muted" style="font-size:12px">Product targets until ${Utils.escHtml(String(progress.product_targets_expires_at).slice(0, 10))}</div>`
        : '';
      const dailyBlock = dailyActive ? `
      <div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px">Daily money target</h4>
        <div style="display:grid;gap:8px;margin-bottom:10px">
          <div><strong>Daily Target:</strong> ${Utils.formatMoney(target, currency)}</div>
          <div><strong>Sales Achieved:</strong> ${Utils.formatMoney(achieved, currency)}</div>
          <div><strong>Remaining:</strong> ${Utils.formatMoney(remaining, currency)}</div>
          <div><strong>Percentage Achieved:</strong> ${pct}%</div>
        </div>
        <div style="height:10px;background:var(--border);border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, pct)}%;background:${progress.met ? 'var(--success)' : 'var(--primary)'}"></div>
        </div>
      </div>` : '';
      const productBlock = products.length ? `
      <div>
        <h4 style="margin:0 0 8px">Product quantity targets</h4>
        ${expires}
        <p style="margin:0 0 10px">Total qty <strong>${prodSoldQty}</strong> / ${prodTargetQty}
          · Total value <strong>${Utils.formatMoney(prodSoldVal, currency)}</strong> / ${Utils.formatMoney(prodTargetVal, currency)}</p>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Price</th><th>Target</th><th>Sold</th><th>Remaining</th><th>Value target</th></tr></thead>
          <tbody>${products.map((p) => `<tr>
            <td>${Utils.escHtml(p.product_name || ('#' + p.product_id))}</td>
            <td>${Utils.formatMoney(p.selling_price || 0, currency)}</td>
            <td>${p.target_qty}</td>
            <td>${p.sold_qty}</td>
            <td>${p.remaining_qty}</td>
            <td>${Utils.formatMoney(p.target_value || ((Number(p.target_qty) || 0) * (Number(p.selling_price) || 0)), currency)}</td>
          </tr>`).join('')}</tbody></table></div>
      </div>` : '';
      const empty = !dailyActive && !products.length
        ? '<p class="muted">No active targets for today. Admin can set Daily and/or Product targets under Sales Targets.</p>'
        : '';
      const body = `${dailyBlock}${productBlock}${empty}`;
      Utils.showModal("Today's Target", body, '<button type="button" class="btn btn-ghost" id="tt-close">Close</button>', { wide: true });
      document.getElementById('tt-close')?.addEventListener('click', () => Utils.hideModal());
    };

    const cached = this._targetProgressCache;
    const freshEnough = cached?.data && (Date.now() - (cached.at || 0)) < 45000;
    if (freshEnough) paint(cached.data);
    else Utils.showModal("Today's Target", '<p class="muted">Loading…</p>', '<button type="button" class="btn btn-ghost" id="tt-close">Close</button>');

    try {
      const r = await API.getTodayTargetProgress(branchId);
      const progress = r?.success !== false ? (r.data || r) : null;
      if (progress) this._targetProgressCache = { at: Date.now(), data: progress };
      paint(progress);
    } catch (_) {
      if (!freshEnough) paint(null);
    }
  },

  async loadDeliveryFee() {
    try {
      const branchId = this.app?.user?.branch_id || this.app?.settings?.branch_id || 1;
      const settings = await API.getDeliveryBranchSettings(branchId, this.app?.user);
      const data = settings?.data ?? settings ?? {};
      const places = Array.isArray(data.places) ? data.places : (Array.isArray(data.zones) ? data.zones : []);
      this.deliveryPlaces = places;
      this.deliverySettings = {
        delivery_fee: Number(data.delivery_fee) || 0,
        free_delivery_above: Number(data.free_delivery_above) || 0,
        min_order: Number(data.min_order) || 0,
        places
      };
      this.recalcDeliveryFee();
      this.renderCart?.();
    } catch (_) {
      this.deliverySettings = { delivery_fee: 0, free_delivery_above: 0, min_order: 0, places: [] };
      this.deliveryPlaces = [];
      this.deliveryFee = 0;
    }
  },

  /** Match online ordering: fee from selected place (or branch flat fee). */
  recalcDeliveryFee(cartSubtotal) {
    if (this.orderType !== 'delivery') {
      this.deliveryFee = 0;
      return 0;
    }
    const place = this.deliveryPlace;
    const s = place || this.deliverySettings || {};
    const sub = Number(cartSubtotal);
    const gross = Number.isFinite(sub)
      ? sub
      : (this.cart || []).reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    const freeAbove = Number(s.free_delivery_above) || 0;
    const fee = Number(s.delivery_fee) || 0;
    const minOrder = Number(s.min_order) || 0;
    if (minOrder > 0 && gross < minOrder) {
      // Still show place fee; checkout will warn
    }
    this.deliveryFee = freeAbove > 0 && gross >= freeAbove ? 0 : fee;
    return this.deliveryFee;
  },

  topSellerPeriod: 'today',

  async render(el, app) {
    this.app = app;
    this._host = el;
    document.body.classList.add('pos-till-active');
    Utils.purgeLegacyPosMenuSnapshots?.();
    const branchId = app.user?.branch_id || undefined;
    const filters = { for_pos: true, actor: app.user };
    const comboFilters = branchId ? { branch_id: branchId, for_pos: true } : { for_pos: true };
    const cachedProd = window.DataCache?.peek?.('products', [filters]);
    const cachedCat = window.DataCache?.peek?.('categories', [filters]);
    const cachedCombo = window.DataCache?.peek?.('combos', [comboFilters]);
    const shiftP = Promise.all([
      API.getShiftSettings().catch(() => ({ success: false })),
      API.getOpenShift(app.user).catch(() => ({ success: false, data: null }))
    ]);
    const startCatalogRefresh = () => {
      if (this._catalogRefreshStarted) return;
      this._catalogRefreshStarted = true;
      Promise.all([
        API.getCategories(filters),
        API.getProducts(filters),
        API.getActiveCombos(comboFilters).catch(() => ({ success: false, data: [] }))
      ]).then(([catRes, prodRes, comboRes]) => {
        this._applyCatalogFromRpc(catRes, prodRes, comboRes, branchId);
        if (this._shiftFlowComplete) this.updateMenuVisibility();
      }).catch(() => {
        if ((this.products || []).length && this._shiftFlowComplete) this.updateMenuVisibility();
      });
    };
    if (app?.ensureFeatureCss) app.ensureFeatureCss('css/pos-till.css').catch(() => {});
    else if (window.App?.ensureFeatureCss) window.App.ensureFeatureCss('css/pos-till.css').catch(() => {});
    try {
    const pendingQuote = app.pendingQuote;
    app.pendingQuote = null;
    // Only reset cart on a true first mount / explicit new sale flow — not on keep-alive revisit
    this._bindPosLiveUpdates();
    if (!this._posMounted) {
      this.cart = [];
      this.discount = 0;
      if (String(this.selectedCategory) === '__all') this.selectedCategory = null;
      this._posMounted = true;
    }
    this.app.settings = {
      ...this.app.settings,
      device_settings: Utils.mergeDeviceSettings(this.app.settings)
    };
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
    const catalogReady = this.tryHydratePosCatalog({ branchId, cachedProd, cachedCat, cachedCombo });
    this.renderLayout(el);
    this.loadDeliveryFee().catch(() => {});
    this.bindEvents(el);
    this.bindMoreMenu(el);
    this.startAdvertReminderMonitor();
    this._lastCatalogStamp = this._catalogStamp();
    this._bindCatalogLiveSync();
    this._bindComboLiveRefresh();
    this._bindSuccessResume();
    if (isKiosk) this.ensureKioskLogout(el);
    this._restoreSuccessIfNeeded();

    this._catalogRefreshStarted = false;
    this._ensureMenuPainted();
    this._runShiftGate().catch(() => this._onShiftConfirmed());

    if (!catalogReady) {
      Utils.loadPosMenuSnapshotAsync(branchId).then((idbSnap) => {
        if (!idbSnap?.products?.length || (this.products || []).length) return;
        this._applyWarmCatalog(idbSnap);
        this._ensureMenuPainted();
        if (this._shiftFlowComplete) this.updateMenuVisibility();
      }).catch(() => {});
      startCatalogRefresh();
    } else {
      const later = () => startCatalogRefresh();
      if (typeof requestIdleCallback === 'function') requestIdleCallback(later, { timeout: 2500 });
      else setTimeout(later, 800);
    }

    shiftP.then(([shiftSettingsRes, shiftRes]) => {
      if (shiftSettingsRes?.success) {
        this.shiftSettings = shiftSettingsRes.data || this.shiftSettings;
      }
      const remoteShift = this._normalizeOpenShift(shiftRes);
      const modalOpen = document.getElementById('modal-overlay')?.dataset.noDismiss === '1';
      if (remoteShift?.id && !modalOpen) this.openShift = remoteShift;
      else if (!remoteShift?.id && !this._shiftFlowComplete && !modalOpen) this.openShift = null;
      this.refreshShiftBarQuick();
      this.updateShiftGate();
    }).catch(() => {});

    shiftP.finally(() => {
      setTimeout(() => {
        API.enforceCashoutDeadlines().then(async (enforced) => {
          if (enforced.success && enforced.data?.closed > 0) {
            const refreshed = await API.getOpenShift(app.user);
            this.openShift = this._normalizeOpenShift(refreshed);
            Utils.toast(`Auto-closed ${enforced.data.closed} shift(s) past cash-out deadline`, 'info');
            this.refreshShiftBarQuick();
            this.updateShiftGate();
          }
        }).catch(() => {});
      }, 400);
    });

    // Refresh sales targets in background (combos already loaded with catalog)
    API.getSalesTargets().catch(() => ({ success: false })).then((targetsRes) => {
      this.salesTargets = targetsRes.success ? (targetsRes.data || { daily: { amount: 0, active: false } }) : { daily: { amount: 0, active: false } };
      this.renderCategoryTabs(this.selectedCategory || '');
      this.updateShiftBar().catch(() => {});
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
    this.refreshShiftBarQuick();
    } catch (err) {
      console.error('[POS] render failed', err);
      el.innerHTML = `<div class="login-card" style="max-width:420px;margin:40px auto;text-align:center">
        <p class="error-msg">POS failed to load: ${Utils.escHtml(err?.message || 'Unknown error')}</p>
        <button type="button" class="btn btn-primary" id="pos-render-retry">Retry</button></div>`;
      document.getElementById('pos-render-retry')?.addEventListener('click', () => this.render(el, app));
    }
  },

  _repaintMenuIfReady() {
    if (!(this.products || []).length) return;
    this._menuTabCountCache = null;
    this._invalidateProductGridCache();
    this.renderCategoryTabs(this.selectedCategory || '');
    this.setActiveCategoryTab(this.selectedCategory || '');
    this.renderProducts(document.getElementById('pos-search')?.value || '');
    this.renderCart?.();
  },

  _bindPosLiveUpdates() {
    if (this._posLiveUpdatesBound) return;
    this._posLiveUpdatesBound = true;
    window.addEventListener('shop-pos-sales-updated', () => {
      this.updateShiftBar().catch(() => {});
    });
    window.addEventListener('shop-pos-targets-updated', async () => {
      this._targetProgressCache = null;
      try {
        const targetsRes = await API.getSalesTargets();
        if (targetsRes.success) {
          this.salesTargets = targetsRes.data || { daily: { amount: 0, active: false } };
        }
      } catch (_) { /* optional */ }
      try { await this._prefetchTodayTarget?.(); } catch (_) { /* */ }
      try { await this.renderTargetBanner?.(); } catch (_) { /* */ }
      this.updateShiftBar().catch(() => {});
    });
    // Phone POS: re-show product targets when app comes back to foreground
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!document.getElementById('pos-target-banner')) return;
      this._targetProgressCache = null;
      this.renderTargetBanner?.().catch(() => {});
    });
  },

  _bindCatalogLiveSync() {
    if (this._catalogLiveSyncBound) return;
    this._catalogLiveSyncBound = true;
    this._catalogRefreshHandler = (e) => {
      const stamp = e?.detail?.stamp || this._catalogStamp();
      if (stamp && stamp === this._lastCatalogStamp) return;
      if (stamp) this._lastCatalogStamp = stamp;
      clearTimeout(this._catalogRefreshDebounce);
      this._catalogRefreshDebounce = setTimeout(() => this.reloadCatalog?.(true), 40);
    };
    window.addEventListener('shop-pos-stock-updated', this._catalogRefreshHandler);
    window.addEventListener('shop-pos-catalog-updated', this._catalogRefreshHandler);
    this._comboRefreshHandler = () => this.reloadCombosOnly?.();
    window.addEventListener('shop-pos-combos-updated', this._comboRefreshHandler);
    if (!this._catalogStorageBound) {
      this._catalogStorageBound = true;
      window.addEventListener('storage', (e) => {
        if (e.key !== 'shop-pos-catalog-ts' || !e.newValue) return;
        if (e.newValue === this._lastCatalogStamp) return;
        this._lastCatalogStamp = e.newValue;
        this.reloadCatalog?.().catch(() => {});
      });
    }
    if (!this._catalogBroadcastBound && typeof BroadcastChannel !== 'undefined') {
      this._catalogBroadcastBound = true;
      try {
        this._catalogBroadcast = new BroadcastChannel('shop-pos-catalog');
        this._catalogBroadcast.onmessage = (ev) => {
          const stamp = ev?.data?.stamp;
          if (!stamp || stamp === this._lastCatalogStamp) return;
          this._lastCatalogStamp = stamp;
          this.reloadCatalog?.().catch(() => {});
        };
      } catch (_) { /* ignore */ }
    }
    if (!this._catalogPollTimer) {
      this._catalogPollTimer = setInterval(() => {
        const stamp = this._catalogStamp();
        if (stamp && stamp !== this._lastCatalogStamp) {
          this._lastCatalogStamp = stamp;
          this.reloadCatalog?.().catch(() => {});
        }
      }, 4000);
    }
    if (!this._catalogServerPollTimer) {
      // Stamp-only when possible; full reload at most every 30s via cache (never force-bypass)
      this._catalogServerPollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const stamp = this._catalogStamp();
        if (stamp && stamp === this._lastCatalogStamp && stamp === this._lastCatalogReloadStamp) return;
        if (stamp && stamp !== this._lastCatalogStamp) {
          this._lastCatalogStamp = stamp;
        }
        this.reloadCatalog?.(false).catch(() => {});
      }, 30000);
    }
  },

  async fetchTodaySalesTotal() {
    if (this.openShift?.id) {
      try {
        const preview = await API.getShiftClosePreview(this.openShift.id, this.app.user);
        if (preview.success) return Number(preview.data?.todaySales) || 0;
      } catch (_) { /* fall through */ }
    }
    const today = Utils.today();
    try {
      const stats = await API.getDashboardStats(today, today, this.app.user);
      const data = stats.data ?? stats;
      return Number(data?.todaySales) || 0;
    } catch (_) {
      return 0;
    }
  },

  async renderTargetBanner() {
    const targetBanner = document.getElementById('pos-target-banner');
    if (!targetBanner) return { todaySales: 0, dailyTarget: 0, pct: 0, met: false };
    const currency = this.app.settings?.currency || 'R';
    const dailyTarget = this.activeDailyTargetAmount();
    let progress = this._targetProgressCache?.data;
    const cacheFresh = this._targetProgressCache?.data && (Date.now() - (this._targetProgressCache.at || 0)) < 12000;
    if (!cacheFresh) {
      try {
        const branchId = this.app?.user?.branch_id || null;
        const r = await API.getTodayTargetProgress?.(branchId);
        if (r?.success !== false) {
          progress = r?.data || r;
          this._targetProgressCache = { at: Date.now(), data: progress };
        }
      } catch (_) { /* keep cache */ }
    }
    const productActive = Array.isArray(progress?.products) && progress.products.length > 0
      && progress?.product_targets_active !== false;
    if (dailyTarget <= 0 && !productActive) {
      targetBanner.style.display = 'none';
      targetBanner.classList.add('hidden');
      targetBanner.innerHTML = '';
      return { todaySales: 0, dailyTarget: 0, pct: 0, met: false };
    }
    const todaySales = dailyTarget > 0
      ? (Number(progress?.sales_achieved) >= 0 ? Number(progress.sales_achieved) : await this.fetchTodaySalesTotal())
      : 0;
    const pct = dailyTarget > 0 ? Math.min(100, Math.round((todaySales / dailyTarget) * 100)) : 0;
    const met = dailyTarget > 0 && todaySales >= dailyTarget;
    const prodSold = Number(progress?.product_sold_qty) || 0;
    const prodTarget = Number(progress?.product_target_qty) || 0;
    const prodValSold = Number(progress?.product_sold_value) || 0;
    const prodValTarget = Number(progress?.product_target_value) || 0;
    const dailyText = dailyTarget > 0
      ? `Daily: <strong>${Utils.formatMoney(todaySales, currency)}</strong> / ${Utils.formatMoney(dailyTarget, currency)}
        <span class="pos-target-pct ${met ? 'met' : ''}">${pct}%${met ? ' ✓ Met' : ''}</span>`
      : '';
    const productText = productActive
      ? `Products: <strong>${prodSold}</strong>/${prodTarget} · ${Utils.formatMoney(prodValSold, currency)} / ${Utils.formatMoney(prodValTarget, currency)}`
      : '';
    targetBanner.style.display = 'block';
    targetBanner.classList.remove('hidden');
    targetBanner.innerHTML = `<div class="pos-target-inner" id="pos-today-target-btn" role="button" tabindex="0" title="Open Today's Target" style="cursor:pointer">
      <span class="pos-target-text">${[dailyText, productText].filter(Boolean).join(' · ')}</span>
      ${dailyTarget > 0 ? `<div class="pos-target-bar"><div class="pos-target-fill ${met ? 'met' : ''}" style="width:${pct}%"></div></div>` : ''}
    </div>`;
    document.getElementById('pos-today-target-btn')?.addEventListener('click', () => this.showTodayTargetModal());
    return { todaySales, dailyTarget, pct, met };
  },

  refreshShiftBarQuick() {
    const main = document.getElementById('pos-shift-bar-main');
    if (!main) return;
    const currency = this.app?.settings?.currency || 'R';
    if (!this._shiftFlowComplete) {
      main.innerHTML = '<span class="muted">Open or continue your shift to start selling</span>';
      return;
    }
    if (!this.requiresShift()) {
      main.innerHTML = '<span class="muted">Shift not required</span>';
      return;
    }
    if (!this.openShift) {
      main.innerHTML = '<span style="color:var(--warning)">No shift open — open shift to sell</span>';
      return;
    }
    main.innerHTML = `<span>Shift open · Float: ${Utils.formatMoney(this.openShift.opening_float, currency)} · ${Utils.formatDateTime(this.openShift.opened_at)}</span>
      <button type="button" class="pos-link-btn" id="pos-cashout-history-inline">Cashout History</button>`;
    document.getElementById('pos-cashout-history-inline')?.addEventListener('click', () => this.showCashOutHistory());
  },

  _finishShiftFlow() {
    this._onShiftConfirmed();
  },

  _shiftFlowComplete: false,

  canPollOnlineOrders() {
    if (!this._shiftFlowComplete) return false;
    if (this.requiresShift() && !this.hasOpenShift()) return false;
    return true;
  },

  canShowOnlineOrders() {
    return this.canPollOnlineOrders();
  },

  _unlockPosAlertSound() {
    if (this._posSoundUnlocked) return;
    this._posSoundUnlocked = true;
    const unlock = () => {
      try {
        window.PanelSound?.setPanel?.('pos');
        window.PanelSound?.startLoop?.();
        window.PanelSound?.stop?.();
      } catch (_) { /* */ }
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
  },

  _startOnlineOrdersWidget() {
    if (!this.canPollOnlineOrders()) return;
    this._unlockPosAlertSound();
    this.app?.ensureFeatureScript?.('js/online-orders-widget.js').then(() => {
      if (!this.canPollOnlineOrders()) return;
      window.OnlineOrdersWidget?.bind?.(this.app);
      window.OnlineOrdersWidget?.startPolling?.();
    }).catch(() => {});
  },

  _syncOnlineOrdersWidget() {
    if (this.canPollOnlineOrders()) {
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
    Utils.showModal('Online Orders', '<p class="muted">Opening…</p>', '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
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
    const btn = el.querySelector('#pos-kiosk-logout');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      this.closeMoreOverlay();
      this.app?.logout?.();
    });
  },

  openMoreOverlay() {
    const overlay = document.getElementById('pos-more-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.classList.add('is-open');
    document.body.classList.add('pos-more-open');
  },

  closeMoreOverlay() {
    const overlay = document.getElementById('pos-more-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    const finish = () => {
      overlay.classList.add('hidden');
      document.body.classList.remove('pos-more-open');
    };
    if (overlay.classList.contains('hidden')) return;
    overlay.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 280);
  },

  bindMoreMenu(el) {
    const toggle = el.querySelector('#pos-more-menu');
    const overlay = document.getElementById('pos-more-overlay');
    const closeBtn = overlay?.querySelector('#pos-more-close');
    const backdrop = overlay?.querySelector('.pos-more-backdrop');
    if (!toggle || !overlay || toggle.dataset.bound) return;
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMoreOverlay();
    });
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMoreOverlay();
    });
    backdrop?.addEventListener('click', () => this.closeMoreOverlay());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('pos-more-backdrop')) this.closeMoreOverlay();
    });
    overlay.querySelector('.pos-more-sheet')?.addEventListener('click', (e) => e.stopPropagation());
    overlay.querySelectorAll('button[id^="pos-"]').forEach((btn) => {
      if (btn.id === 'pos-more-menu' || btn.id === 'pos-more-close') return;
      btn.addEventListener('click', () => this.closeMoreOverlay());
    });
    if (!this._moreEscHandler) {
      this._moreEscHandler = (e) => {
        if (e.key === 'Escape') this.closeMoreOverlay();
      };
      document.addEventListener('keydown', this._moreEscHandler);
    }
  },

  _catalogStamp() {
    try { return localStorage.getItem('shop-pos-catalog-ts') || ''; } catch (_) { return ''; }
  },

  loadPosCatalogSnapshot(branchId) {
    return Utils.loadPosMenuSnapshot(branchId);
  },

  savePosCatalogSnapshot(branchId) {
    if (!(this.products || []).length) return;
    Utils.savePosMenuSnapshot(branchId, {
      categories: this.categories || [],
      products: this.products,
      combos: this.combos || []
    });
  },

  /** Warm session snapshot from login prefetch (before POS page opens). */
  persistMenuSnapshot(branchId, catRes, prodRes, comboRes) {
    const categories = this._unwrapRpcList(catRes);
    const products = this._unwrapRpcList(prodRes);
    const rawCombos = comboRes?.data ?? (Array.isArray(comboRes) ? comboRes : []);
    const combos = this.filterActiveCombos(rawCombos);
    if (!products.length) return;
    const bid = this._warmCatalogBranchId(branchId);
    window.__POS_WARM_CATALOG__ = { branchId: bid, categories, products, combos, at: Date.now() };
    if (window.POSPage && POSPage !== this) {
      POSPage.categories = categories;
      POSPage.products = Utils.restorePosCatalogProducts(products);
      POSPage.combos = combos;
      POSPage.rebuildProductLookups?.();
    }
    Utils.savePosMenuSnapshot(branchId, { categories, products, combos });
  },

  _warmCatalogBranchId(branchId) {
    const bid = branchId != null && branchId !== '' ? Number(branchId) : 0;
    return bid || 0;
  },

  _applyWarmCatalog(warm) {
    if (!warm?.products?.length) return false;
    this.categories = warm.categories || [];
    this.products = Utils.restorePosCatalogProducts(warm.products);
    this.combos = this.filterActiveCombos(warm.combos || []);
    this.rebuildProductLookups?.();
    return true;
  },

  tryHydratePosCatalog({ branchId, cachedProd, cachedCat, cachedCombo } = {}) {
    if ((this.products || []).length) return true;
    const warm = window.__POS_WARM_CATALOG__;
    const bid = this._warmCatalogBranchId(branchId);
    if (warm?.products?.length && this._warmCatalogBranchId(warm.branchId) === bid) {
      return this._applyWarmCatalog(warm);
    }
    if (cachedProd?.data?.length) {
      this.categories = cachedCat?.data || this.categories || [];
      this.products = Utils.restorePosCatalogProducts(cachedProd.data);
      this.combos = this.filterActiveCombos(cachedCombo?.data || cachedCombo || this.combos || []);
      this.rebuildProductLookups?.();
      return true;
    }
    const snap = this.loadPosCatalogSnapshot(branchId);
    if (snap?.products?.length) {
      this.categories = snap.categories || [];
      this.products = snap.products;
      this.combos = this.filterActiveCombos(snap.combos || []);
      this.rebuildProductLookups?.();
      return true;
    }
    return false;
  },

  /** Sync paint — menu must exist in DOM before shift modal closes. */
  _ensureMenuPainted() {
    if (!(this.products || []).length) return false;
    this.ensureDefaultCategory();
    this._menuTabCountCache = null;
    this._invalidateProductGridCache();
    this.renderCategoryTabs(this.selectedCategory || '');
    this.renderProducts(document.getElementById('pos-search')?.value || '');
    this.renderCart?.();
    this.prefetchVisibleProductOptions();
    return true;
  },

  updateMenuVisibility() {
    const layout = document.querySelector('.pos-layout');
    if (!layout) return;
    const waiting = !this._shiftFlowComplete
      || (this.requiresShift() && !this.hasOpenShift());
    layout.classList.toggle('pos-menu-waiting', waiting);
  },

  _peekCachedOpenShift() {
    try {
      const cached = window.DataCache?.peek?.('openShift', [this.app?.user]);
      if (cached?.data) return this._normalizeOpenShift(cached);
    } catch (_) { /* ignore */ }
    return null;
  },

  /** Shift modal immediately — never wait on network before showing Open/Continue. */
  async _runShiftGate() {
    this._shiftFlowComplete = false;
    this.shiftSettings = this.app.settings?.shift_settings || this.shiftSettings || {
      required_roles: ['cashier', 'manager', 'assistant_manager', 'owner']
    };
    const cachedShift = this._peekCachedOpenShift();
    if (cachedShift?.id) this.openShift = cachedShift;
    this.refreshShiftBarQuick();
    this.updateMenuVisibility();
    this.updateShiftGate();

    if (!this.requiresShift()) {
      this._onShiftConfirmed();
      return;
    }
    if (this.openShift?.id) await this.promptResumeShift();
    else await this.ensureShift();
    if (!this._shiftFlowComplete) this._onShiftConfirmed();
  },

  _onShiftConfirmed() {
    this._shiftFlowComplete = true;
    this._unlockPosAlertSound();
    this._ensureMenuPainted();
    this.updateMenuVisibility();
    this.updateShiftGate();
    this.refreshShiftBarQuick();
    this._startOnlineOrdersWidget();
    this._prefetchPosTools();
    this.updateShiftBar().catch(() => {});
  },

  /** Keep-alive revisit: preserve cart, refresh catalog/shift in background. */
  async activate(el, app) {
    if (!el?.querySelector?.('.pos-layout')) {
      return this.render(el, app);
    }
    this.app = app;
    this._host = el;
    if (!this._restoreSuccessIfNeeded()) this.resetPosSaleUi();
    const stamp = this._catalogStamp();
    if (stamp && stamp !== this._lastCatalogStamp) {
      this._lastCatalogStamp = stamp;
      this.reloadCatalog(true).catch(() => {});
    }
    const filters = { for_pos: true, actor: app.user };
    const branchId = app.user?.branch_id || undefined;
    const comboFilters = branchId ? { branch_id: branchId, for_pos: true } : { for_pos: true };
    const cachedProd = window.DataCache?.peek?.('products', [filters]);
    const cachedCat = window.DataCache?.peek?.('categories', [filters]);
    const cachedCombo = window.DataCache?.peek?.('combos', [comboFilters]);
    let hydrated = this.tryHydratePosCatalog({ branchId, cachedProd, cachedCat, cachedCombo });
    if (!hydrated) {
      const idbSnap = await Utils.loadPosMenuSnapshotAsync(branchId);
      if (idbSnap?.products?.length) {
        this.categories = idbSnap.categories || [];
        this.products = idbSnap.products;
        this.combos = this.filterActiveCombos(idbSnap.combos || []);
        this.rebuildProductLookups?.();
        hydrated = true;
      }
    }
    if (hydrated) {
      this.renderCategoryTabs(this.selectedCategory || '');
      this.renderProducts(document.getElementById('pos-search')?.value || '');
      this.refreshShiftBarQuick?.();
      this.updateShiftGate?.();
      if (typeof this.renderCart === 'function') this.renderCart();
      this.prefetchPosProductImages();
      this.refreshTakenCountBadge();
    }
    if (hydrated && !stamp) return;
    Promise.all([
      API.getOpenShift(app.user)
    ]).then(([shiftRes]) => {
      this.openShift = this._normalizeOpenShift(shiftRes);
      this.refreshShiftBarQuick?.();
      this.updateShiftGate?.();
      window.DataCache?.clearStaleBanner?.(el);
    }).catch(() => {});
  },

  requiresShift() {
    const roles = this.shiftSettings?.required_roles
      || this.app.settings?.shift_settings?.required_roles
      || ['cashier', 'manager', 'assistant_manager', 'owner'];
    return roles.includes(this.app.user?.role);
  },

  hasOpenShift() {
    return !!(this.openShift?.id);
  },

  requireShift(actionLabel) {
    if (!this.requiresShift() || this.hasOpenShift()) return true;
    Utils.toast(`Open your shift before ${actionLabel || 'using POS'}`, 'error');
    this.ensureShift();
    return false;
  },

  updateShiftGate() {
    const layout = document.querySelector('.pos-layout');
    const block = this._shiftFlowComplete && this.requiresShift() && !this.hasOpenShift();
    if (layout) layout.classList.toggle('pos-shift-blocked', block);
    this.updateMenuVisibility();
    this.refreshShiftBarQuick();
    this._syncOnlineOrdersWidget();
  },

  async ensureShift() {
    if (!this.requiresShift() || this.openShift?.id) return;
    if (document.getElementById('modal-overlay')?.dataset.noDismiss === '1') {
      await new Promise((resolve) => {
        const started = Date.now();
        const t = setInterval(() => {
          const blocked = document.getElementById('modal-overlay')?.dataset.noDismiss === '1';
          if (!blocked || Date.now() - started > 120000) {
            clearInterval(t);
            resolve();
          }
        }, 200);
      });
      if (this.openShift?.id) return;
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
        const openingFloat = parseFloat(document.getElementById('pos-shift-float').value) || 0;
        const localId = `local-${Date.now()}`;
        this._pendingLocalShift = {
          id: localId,
          opening_float: openingFloat,
          opened_at: new Date().toISOString(),
          pending: true
        };
        this.openShift = this._pendingLocalShift;
        document.getElementById('modal-overlay').dataset.noDismiss = '0';
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.style.display = '';
        Utils.forceHideModal();
        this._onShiftConfirmed();
        resolve();

        btn.disabled = true;
        btn.textContent = 'Opening…';
        try {
          const r = await API.openShift(openingFloat, this.app.user);
          if (r.success && r.data?.id) {
            this.openShift = r.data;
            this._pendingLocalShift = null;
            this.refreshShiftBarQuick();
          } else if (!r.success) {
            Utils.briefNotice(r.error || 'Shift saved locally — will sync when online', 'warning');
          }
        } catch (_) {
          Utils.briefNotice('Shift opened locally — will sync when online', 'info');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Open Shift & Start Selling';
        }
      });
    });
  },

  async promptResumeShift() {
    if (!this.openShift?.id || !this.requiresShift()) return;
    const currency = this.app.settings?.currency || 'R';

    const choice = await new Promise((resolve) => {
      Utils.showModal('Continue Your Shift?', `
        <p>You have an open shift from a previous session.</p>
        <p><strong>Opened:</strong> ${Utils.formatDateTime(this.openShift.opened_at)}</p>
        <p><strong>Opening float:</strong> ${Utils.formatMoney(this.openShift.opening_float, currency)}</p>
        <p id="pos-resume-sales-line"><strong>Sales this shift:</strong> <span class="muted">Loading…</span></p>
        <p class="muted">Continue working this shift, or close it now if you are done for the day.</p>`,
        `<button class="btn btn-secondary" id="pos-close-resume-shift">Close Shift</button>
         <button class="btn btn-success" id="pos-continue-shift">Continue Shift</button>`,
        { noDismiss: true });
      document.getElementById('pos-continue-shift').addEventListener('click', () => {
        document.getElementById('modal-overlay').dataset.noDismiss = '0';
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.style.display = '';
        Utils.forceHideModal();
        this._onShiftConfirmed();
        resolve('continue');
      });
      document.getElementById('pos-close-resume-shift').addEventListener('click', () => {
        document.getElementById('modal-overlay').dataset.noDismiss = '0';
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.style.display = '';
        Utils.hideModal();
        resolve('close');
      });
      API.getShiftClosePreview(this.openShift.id, this.app.user).then((preview) => {
        const line = document.getElementById('pos-resume-sales-line');
        if (!line) return;
        let shiftSales = 0;
        let saleCount = 0;
        if (preview?.success) {
          shiftSales = preview.data?.shiftSales ?? preview.data?.totalSales ?? 0;
          saleCount = preview.data?.saleCount ?? 0;
        }
        const salesLine = saleCount > 0
          ? `${Utils.formatMoney(shiftSales, currency)} (${saleCount} sale${saleCount === 1 ? '' : 's'})`
          : Utils.formatMoney(shiftSales, currency);
        line.innerHTML = `<strong>Sales this shift:</strong> ${salesLine}`;
      }).catch(() => {
        const line = document.getElementById('pos-resume-sales-line');
        if (line) line.innerHTML = '<strong>Sales this shift:</strong> <span class="muted">—</span>';
      });
    });

    if (choice === 'close') {
      await this.showCashOut();
      try {
        const refreshed = await API.getOpenShift(this.app.user);
        this.openShift = this._normalizeOpenShift(refreshed);
      } catch (_) {
        this.openShift = null;
        this._pendingLocalShift = null;
      }
      if (!this.openShift?.id && this.requiresShift()) {
        await this.ensureShift();
      } else {
        this._onShiftConfirmed();
      }
    }
  },

  async updateShiftBar() {
    const bar = document.getElementById('pos-shift-bar');
    const main = document.getElementById('pos-shift-bar-main');
    const branchLabel = document.getElementById('pos-branch-label');
    if (branchLabel) {
      const bname = this.activeBranch?.name || this.app?.activeBranch?.name || this.app?.settings?.branch_name || '';
      if (bname) {
        branchLabel.textContent = bname;
        branchLabel.classList.remove('hidden');
      } else {
        try {
          const br = await API.getActiveBranch();
          if (br?.success && br.data?.name) {
            this.activeBranch = br.data;
            branchLabel.textContent = br.data.name;
            branchLabel.classList.remove('hidden');
          } else branchLabel.classList.add('hidden');
        } catch (_) { branchLabel.classList.add('hidden'); }
      }
    }
    if (!bar || !main) return;
    this.refreshShiftBarQuick();
    const currency = this.app.settings?.currency || 'R';
    const { todaySales, dailyTarget, pct, met } = await this.renderTargetBanner();
    if (!this.openShift) {
      await this.updateTopSellerBar();
      return;
    }
    let progressHtml = '';
    if (dailyTarget > 0) {
      progressHtml = ` · Target: ${Utils.formatMoney(todaySales, currency)} / ${Utils.formatMoney(dailyTarget, currency)} (${pct}%)${met ? ' ✓' : ''}`;
    }
    main.innerHTML = `<span>Shift open · Float: ${Utils.formatMoney(this.openShift.opening_float, currency)} · ${Utils.formatDateTime(this.openShift.opened_at)}${progressHtml}</span>
      <button type="button" class="pos-link-btn" id="pos-cashout-history-inline">Cashout History</button>`;
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
      <div class="pos-till pos-mobile-show-menu">
      <div class="pos-layout">
        ${campaignBanner ? `<div class="pos-campaign-banners">${campaignBanner}</div>` : ''}
        <div class="pos-products">
          <div class="pos-till-header">
            <div class="pos-search-row">
              <div class="pos-search-field">
                <svg class="pos-field-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>
                <input type="search" id="pos-search" placeholder="Search products or scan barcode…" autofocus>
                <button type="button" class="pos-search-scan" id="pos-scan-toggle" title="Barcode scanner mode">Scan</button>
              </div>
              <div class="pos-customer-row">
                <div class="pos-customer-wrap">
                  <input type="search" id="pos-customer-search" placeholder="Customer name or phone…" autocomplete="off">
                  <div id="pos-customer-dropdown" class="search-dropdown hidden"></div>
                </div>
                <button type="button" class="pos-till-btn ghost sm" id="pos-clear-customer" title="Clear customer" style="display:none">Clear</button>
                <button type="button" class="pos-till-btn ghost sm" id="pos-add-customer" title="Add customer">+ Customer</button>
                <button type="button" class="pos-till-btn primary sm" id="pos-other-item" title="Sell other item">+ Other Item</button>
                <span id="pos-table-label" class="pos-table-label muted hidden"></span>
              </div>
              <div class="field" style="margin:6px 0 0;position:relative">
                <input type="text" id="pos-referral-code" placeholder="Referral code (optional)" autocomplete="off" style="width:100%;text-transform:uppercase;font-size:13px;padding-right:56px">
                <button type="button" id="pos-referral-clear" class="btn btn-ghost btn-sm" title="Remove referral person from this order" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:2px 8px;font-size:11px;z-index:41">Clear</button>
                <div id="pos-referral-dropdown" class="search-dropdown hidden" style="position:absolute;left:0;right:0;top:100%;z-index:40"></div>
                <p id="pos-referral-hint" class="muted" style="margin:4px 0 0;font-size:11px;min-height:14px"></p>
              </div>
            </div>
            <div class="pos-action-bar">
              <button type="button" class="pos-action-chip" id="pos-held" title="Held orders">
                <span class="pos-action-chip-icon"><svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg></span>
                <span class="pos-action-chip-label">Held</span>
                <span id="pos-held-count" class="pos-action-badge hidden">0</span>
              </button>
              <button type="button" class="pos-action-chip" id="pos-online-orders" title="Online orders">
                <span class="pos-action-chip-icon"><svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/><path d="M2 3h2l2.4 12.4a2 2 0 002 1.6h9.8a2 2 0 002-1.6L22 7H6"/></svg></span>
                <span class="pos-action-chip-label">Online</span>
                <span id="pos-online-orders-count" class="pos-action-badge hidden">0</span>
              </button>
              <button type="button" class="pos-action-chip" id="pos-quote" title="Save cart as quote">
                <span class="pos-action-chip-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg></span>
                <span class="pos-action-chip-label">Quote</span>
              </button>
              <button type="button" class="pos-action-chip pos-action-chip--danger" id="pos-void" title="Void sale">
                <span class="pos-action-chip-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg></span>
                <span class="pos-action-chip-label">Void</span>
              </button>
              <button type="button" class="pos-action-chip pos-action-chip--warn" id="pos-refund" title="Refund">
                <span class="pos-action-chip-icon"><svg viewBox="0 0 24 24"><path d="M3 10h13a4 4 0 010 8H7"/><path d="M3 10l4-4M3 10l4 4"/></svg></span>
                <span class="pos-action-chip-label">Refund</span>
              </button>
              <button type="button" class="pos-action-chip pos-action-chip--cash" id="pos-cashout" title="Cash out shift">
                <span class="pos-action-chip-icon"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M7 15h.01M11 15h2"/></svg></span>
                <span class="pos-action-chip-label">Cash Out</span>
              </button>
            </div>
          </div>
          <div id="pos-scan-banner" class="pos-scan-banner hidden">Scanner ready — scan barcode or type code and press Enter</div>
          <div id="pos-target-banner" class="pos-target-banner hidden"></div>
          <div id="pos-shift-bar" class="pos-status-strip">
            <div class="pos-status-left">
              <span id="pos-branch-label" class="pos-shift-branch hidden"></span>
              <span id="pos-conn-badge" class="pos-conn-badge" role="status" aria-live="polite"></span>
              <span id="pos-shift-bar-main" class="pos-shift-main"></span>
            </div>
            <div id="pos-top-seller-bar" class="pos-top-seller">
              <span class="pos-top-seller-label">Top seller</span>
              <span id="pos-top-seller" class="muted">…</span>
              <button type="button" class="pos-period-pill ${this.topSellerPeriod === 'today' ? 'active' : ''}" data-top-period="today">Today</button>
              <button type="button" class="pos-period-pill ${this.topSellerPeriod === 'week' ? 'active' : ''}" data-top-period="week">Week</button>
              <button type="button" class="pos-period-pill ${this.topSellerPeriod === 'month' ? 'active' : ''}" data-top-period="month">Month</button>
            </div>
          </div>
          <div class="category-tabs" id="pos-categories"></div>
          <div class="product-grid" id="pos-grid"></div>
        </div>
        <div class="pos-cart">
          <div class="pos-cart-head">
            <div class="form-tabs pos-quote-tabs" id="pos-quote-tabs">
              <button type="button" class="form-tab active" data-qtab="current">Current Order</button>
              <button type="button" class="form-tab" data-qtab="saved">Saved <span id="pos-saved-quotes-count" class="tag tag-warn hidden">0</span></button>
              <button type="button" class="form-tab" data-qtab="history">History</button>
              <button type="button" class="form-tab pos-more-tab" id="pos-more-menu" title="More tools">☰ More</button>
            </div>
          </div>
          <div id="pos-quote-panel-current" class="pos-cart-panel">
            <div class="cart-items" id="pos-cart-items"><p class="muted cart-empty">Tap a product to add</p></div>
            <div class="cart-summary">
              <div class="summary-row hidden" id="cart-subtotal-excl-row"><span id="cart-subtotal-excl-label">Subtotal (excl. tax)</span><span id="cart-subtotal-excl">${currency}0.00</span></div>
              <div class="summary-row"><span>Subtotal</span><span id="cart-subtotal">${currency}0.00</span></div>
              <div class="summary-row"><span>Discount</span><span id="cart-discount">${currency}0.00</span></div>
              <div class="summary-row hidden" id="cart-tax-row"><span id="cart-tax-label">Tax</span><span id="cart-tax">${currency}0.00</span></div>
              <div class="summary-row hidden" id="cart-delivery-fee-row"><span>Delivery fee</span><span id="cart-delivery-fee">${currency}0.00</span></div>
              <div class="summary-row hidden" id="pos-loyalty-row"><span id="pos-loyalty-label">Customer points</span><span id="pos-loyalty-value">0</span></div>
              <div class="summary-row total"><span>Total</span><span id="cart-total">${currency}0.00</span></div>
              <div class="cart-actions">
                <button class="btn btn-ghost" id="pos-discount">Discount</button>
                <button class="btn btn-ghost" id="pos-hold">Hold</button>
                <button class="btn btn-ghost" id="pos-save-quote">Save Quote</button>
                <button class="btn btn-warning" id="pos-laybuy" title="Create lay-bye from cart">📋 Lay-Bye</button>
                <button class="btn btn-ghost" id="pos-laybuy-pay" title="Take lay-bye payment">💰 Pay Lay-Bye</button>
                <button class="btn btn-warning" id="pos-taken" title="Food taken now — pay later">TAKEN – PAY LATER</button>
                <button class="btn btn-ghost" id="pos-taken-list" title="Unpaid / taken orders">UNPAID / TAKEN <span id="pos-taken-count" class="pos-action-badge hidden">0</span></button>
                <button class="btn btn-danger" id="pos-cancel">Cancel</button>
                <button class="btn btn-success btn-pay" id="pos-pay">Pay</button>
              </div>
            </div>
          </div>
          <div id="pos-quote-panel-saved" class="pos-cart-panel hidden pos-cart-scroll"></div>
          <div id="pos-quote-panel-history" class="pos-cart-panel hidden pos-cart-scroll"></div>
        </div>
      </div>
      <nav class="pos-mobile-dock" id="pos-mobile-dock" aria-label="Switch menu or cart">
        <button type="button" class="pos-mobile-dock-btn active" data-pos-panel="menu">
          <span class="pos-mobile-dock-label">Menu</span>
        </button>
        <button type="button" class="pos-mobile-dock-btn" data-pos-panel="cart">
          <span class="pos-mobile-dock-label">Cart</span>
          <span class="pos-mobile-dock-total" id="pos-mobile-cart-total">${currency}0.00</span>
          <span class="pos-mobile-dock-count hidden" id="pos-mobile-cart-count">0</span>
        </button>
      </nav>
      </div>
      <div id="pos-more-overlay" class="pos-more-overlay hidden" role="dialog" aria-modal="true" aria-label="More POS tools">
        <div class="pos-more-backdrop" aria-hidden="true"></div>
        <div class="pos-more-sheet">
          <header class="pos-more-header">
            <div class="pos-more-header-brand">
              <span class="pos-more-header-icon" aria-hidden="true">⚙</span>
              <div>
                <h2>POS Tools</h2>
                <p>Hardware, promotions &amp; till utilities</p>
              </div>
            </div>
            <button type="button" class="pos-more-close-btn" id="pos-more-close" aria-label="Close">
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div class="pos-more-body">
            <section class="pos-more-section">
              <h3 class="pos-more-section-title">Floor &amp; hardware</h3>
              <div class="pos-more-grid">
                <button type="button" class="pos-more-tool" id="pos-free-tables">
                  <span class="pos-more-tool-icon">🪑</span>
                  <span class="pos-more-tool-text"><strong>Free Table</strong><small>Release sit-in tables</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-today-target">
                  <span class="pos-more-tool-icon">🎯</span>
                  <span class="pos-more-tool-text"><strong>Today's Target</strong><small>Sales &amp; product progress</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-scanner">
                  <span class="pos-more-tool-icon">📡</span>
                  <span class="pos-more-tool-text"><strong>Scanner</strong><small>USB / Bluetooth barcode</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-printers">
                  <span class="pos-more-tool-icon">🖨️</span>
                  <span class="pos-more-tool-text"><strong>Printers</strong><small>This device setup</small></span>
                </button>
              </div>
            </section>
            <section class="pos-more-section">
              <h3 class="pos-more-section-title">Displays</h3>
              <div class="pos-more-grid">
                <button type="button" class="pos-more-tool" id="pos-kitchen-display">
                  <span class="pos-more-tool-icon">🍳</span>
                  <span class="pos-more-tool-text"><strong>Kitchen</strong><small>Open kitchen screen</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-customer-display">
                  <span class="pos-more-tool-icon">📺</span>
                  <span class="pos-more-tool-text"><strong>Customer Board</strong><small>Order status display</small></span>
                </button>
              </div>
            </section>
            <section class="pos-more-section">
              <h3 class="pos-more-section-title">History &amp; cash</h3>
              <div class="pos-more-grid">
                <button type="button" class="pos-more-tool" id="pos-reprint">
                  <span class="pos-more-tool-icon">🧾</span>
                  <span class="pos-more-tool-text"><strong>Reprint</strong><small>Last receipt</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-cash-drop">
                  <span class="pos-more-tool-icon">💵</span>
                  <span class="pos-more-tool-text"><strong>Cash Drop</strong><small>Send cash to admin</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-cashout-history">
                  <span class="pos-more-tool-icon">📜</span>
                  <span class="pos-more-tool-text"><strong>Shift History</strong><small>Past cash-outs</small></span>
                </button>
                <button type="button" class="pos-more-tool" id="pos-sales-history">
                  <span class="pos-more-tool-icon">📊</span>
                  <span class="pos-more-tool-text"><strong>Sales</strong><small>Today &amp; by date</small></span>
                </button>
                <button type="button" class="pos-more-tool pos-more-tool-danger hidden" id="pos-kiosk-logout">
                  <span class="pos-more-tool-icon">⎋</span>
                  <span class="pos-more-tool-text"><strong>Logout</strong><small>Exit kiosk mode</small></span>
                </button>
              </div>
            </section>
          </div>
          <footer class="pos-more-footer">
            <span>Tap outside or Close to return to the till</span>
          </footer>
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
            <button class="btn btn-ghost btn-lg" id="pos-success-review">⭐ Request Review</button>
            <button class="btn btn-ghost btn-lg hidden" id="pos-success-recipe">📖 Send Recipe on WhatsApp</button>
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
      const gen = ++this._customerSearchGen || (this._customerSearchGen = 1);
      const myGen = this._customerSearchGen;
      try {
        const res = await API.getCustomers(q);
        if (myGen !== this._customerSearchGen) return; // stale keystrokes ignored
        this.customers = res?.data || res || [];
        if (!Array.isArray(this.customers)) this.customers = [];
        showResults(this.customers);
      } catch (_) {
        if (myGen !== this._customerSearchGen) return;
        showResults([]);
      }
    };

    if (this._customerSearchTimer) clearTimeout(this._customerSearchTimer);
    this._customerSearchGen = 0;
    input.oninput = () => {
      if (this._customerSearchTimer) clearTimeout(this._customerSearchTimer);
      const q = input.value.trim();
      if (!q) {
        dropdown.classList.add('hidden');
        // Clearing the search must also remove the customer from Current Order / Pay
        if (this.selectedCustomer) this.clearCustomer();
        return;
      }
      if (this.selectedCustomer && q === `${this.selectedCustomer.name}${this.selectedCustomer.phone ? ` (${this.selectedCustomer.phone})` : ''}`) {
        dropdown.classList.add('hidden');
        return;
      }
      this._customerSearchTimer = setTimeout(() => runSearch(q), 180);
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
    document.getElementById('pos-loyalty-row')?.classList.add('hidden');
    const loyaltyLabel = document.getElementById('pos-loyalty-label');
    const loyaltyValue = document.getElementById('pos-loyalty-value');
    if (loyaltyLabel) loyaltyLabel.textContent = 'Customer points';
    if (loyaltyValue) loyaltyValue.textContent = '0';
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
    this._invalidateProductGridCache();
    this.updateProductStockDisplay?.();
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

  calcPromoUnitPrice(product, allMods) {
    const promoActive = !!product.promo_active;
    const normal = Number(product.original_price ?? product.selling_price) || 0;
    const sale = Number(product.selling_price) || 0;
    const extraTotal = (allMods || []).reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
    const hasRemoval = (allMods || []).some((m) =>
      m.modifier_type === 'removal' || (Number(m.extra_price) < 0 && m.modifier_type !== 'extra' && m.modifier_type !== 'option'));
    if (promoActive && hasRemoval) {
      return { unitPrice: Math.round((normal + extraTotal) * 100) / 100, optedOut: true };
    }
    if (promoActive) {
      return { unitPrice: Math.round((sale + extraTotal) * 100) / 100, optedOut: false };
    }
    return { unitPrice: Math.round((sale + extraTotal) * 100) / 100, optedOut: false };
  },

  comboMatchesCategory(combo, categoryKey) {
    if (!categoryKey || categoryKey === 'combos') return true;
    const cat = this.categories.find(c => String(c.id) === String(categoryKey));
    if (!cat) return false;
    const label = (combo.category || 'COMBOS').trim().toLowerCase();
    return label === cat.name.trim().toLowerCase();
  },

  /** Keep POS menu aligned with admin — active, approved, in date, show_on_pos. */
  filterActiveCombos(list) {
    const today = Utils.today();
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return (list || []).filter((c) => {
      if (!c || c.id == null) return false;
      if (String(c.status || 'active') !== 'active') return false;
      if (String(c.approval_status || 'approved') !== 'approved') return false;
      if (Number(c.show_on_pos) === 0) return false;
      if (c.start_date && c.start_date > today) return false;
      if (c.end_date && c.end_date < today) return false;
      if (c.valid_time_start && c.valid_time_end) {
        const start = c.valid_time_start;
        const end = c.valid_time_end;
        if (start <= end) {
          if (hhmm < start || hhmm > end) return false;
        } else if (hhmm < start && hhmm > end) {
          return false;
        }
      }
      return true;
    });
  },

  setPosCombos(comboRes) {
    const raw = comboRes?.data ?? (Array.isArray(comboRes) ? comboRes : []);
    this.combos = this.filterActiveCombos(raw);
  },

  comboFilters() {
    const branchId = this.app?.user?.branch_id || this.app?.activeBranch?.id || undefined;
    return branchId ? { branch_id: branchId, for_pos: true } : { for_pos: true };
  },

  async fetchPosCombos(force = false) {
    if (typeof API === 'undefined' || typeof API.getActiveCombos !== 'function') return [];
    const filters = this.comboFilters();
    if (force) window.DataCache?.invalidate?.('combos');
    const fn = (force && API.getActiveCombos._uncached) ? API.getActiveCombos._uncached : API.getActiveCombos;
    try {
      return await fn(filters);
    } catch (_) {
      return { success: false, data: [] };
    }
  },

  _bindComboLiveRefresh() {
    if (this._comboLiveRefreshBound) return;
    this._comboLiveRefreshBound = true;
    const tick = () => {
      if (this.app?.currentPage !== 'pos') return;
      if (!document.getElementById('pos-grid')) return;
      this.reloadCombosOnly().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
    this._comboRefreshInterval = setInterval(tick, 45000);
  },

  async reloadCombosOnly() {
    if (!this.app?.user) return;
    try {
      const comboRes = await this.fetchPosCombos(true);
      if (comboRes?.success === false) return;
      this.setPosCombos(comboRes);
      this._invalidateProductGridCache();
      this.renderCategoryTabs(this.selectedCategory || '');
      this.renderProducts(document.getElementById('pos-search')?.value || '');
    } catch (_) { /* ignore */ }
  },

  combosForView(categoryKey, filter = '') {
    if (categoryKey !== 'combos') return [];
    let list = this.filterActiveCombos(this.combos || []);
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.combo_code?.toLowerCase().includes(q));
    }
    return list;
  },

  rebuildProductLookups() {
    this._categoryById = new Map((this.categories || []).map(c => [String(c.id), c]));
    this._productsNeedingOptions = new Set();
    this._promoProducts = [];
    const today = new Date().toLocaleDateString('en-CA');
    let availToday = 0;
    let newArrival = 0;
    let bestSeller = 0;
    let todaySpecial = 0;
    for (const p of this.products || []) {
      if (this.productNeedsDialog(p)) this._productsNeedingOptions.add(String(p.id));
      if (Number(p.available_today) === 1) availToday++;
      if (Number(p.is_new_arrival) === 1 && (!p.new_arrival_until || p.new_arrival_until >= today)) newArrival++;
      if (Number(p.is_best_seller) === 1) bestSeller++;
      if (p.promo_active) {
        todaySpecial++;
        this._promoProducts.push(p);
      }
    }
    this._menuTabCountCache = {
      __available_today: availToday,
      __new_arrival: newArrival,
      __best_seller: bestSeller,
      __today_special: todaySpecial
    };
  },

  _updateCampaignBanners() {
    const layout = document.querySelector('.pos-layout');
    if (!layout) return;
    const html = (this.activeCampaigns || []).slice(0, 2).map((c) =>
      `<div class="pos-campaign-banner">🔥 ${c.title}${c.end_date ? ` — ends ${c.end_date}` : ''}</div>`
    ).join('');
    let el = layout.querySelector('.pos-campaign-banners');
    if (!html) {
      el?.remove();
      return;
    }
    if (el) el.innerHTML = html;
    else layout.insertAdjacentHTML('afterbegin', `<div class="pos-campaign-banners">${html}</div>`);
  },

  async reloadCatalog(force = false) {
    if (!this.app?.user) return;
    const stamp = this._catalogStamp();
    if (!force && stamp && stamp === this._lastCatalogReloadStamp) return;
    try {
      const filters = { for_pos: true, actor: this.app.user, omit_images: true };
      // Prefer DataCache (SWR/dedupe). Only bypass when force=true after a real catalog mutation stamp.
      const fetchCat = force && API.getCategories?._uncached
        ? API.getCategories._uncached(filters)
        : API.getCategories(filters);
      const fetchProd = force && API.getProducts?._uncached
        ? API.getProducts._uncached(filters)
        : API.getProducts(filters);
      const fetchHl = force && API.getMenuHighlightSettings?._uncached
        ? API.getMenuHighlightSettings._uncached()
        : API.getMenuHighlightSettings();
      const [catRes, prodRes, comboRes, hlRes] = await Promise.all([
        fetchCat,
        fetchProd,
        this.fetchPosCombos(!!force),
        fetchHl.catch(() => null)
      ]);
      if (hlRes?.success && hlRes.data) {
        this.app.settings = this.app.settings || {};
        this.app.settings.customization = {
          ...(this.app.settings.customization || {}),
          menu_highlight_settings: hlRes.data
        };
      }
      this._applyCatalogFromRpc(catRes, prodRes, comboRes, this.app.user?.branch_id);
      this._updateCampaignBanners();
      this._lastCatalogReloadStamp = stamp || String(Date.now());
      if (stamp) this._lastCatalogStamp = stamp;
      this.savePosCatalogSnapshot(this.app.user?.branch_id);
    } catch (err) {
      Utils.toast?.(err?.message || 'Menu refresh failed — showing last loaded menu', 'warning');
    }
  },

  comboNeedsOptions(combo) {
    if (combo.combo_kind === 'custom') return false;
    const set = this._productsNeedingOptions;
    return (combo.items || []).some(i => {
      if (i.allow_pap_choice && i.product_id) return true;
      if (!i.product_id) return false;
      if (!set) {
        const p = this.products.find(x => x.id == i.product_id);
        return p && this.productNeedsDialog(p);
      }
      return set.has(String(i.product_id));
    });
  },

  comboItemImgAttr(item) {
    if (item?.product_id) {
      return Utils.productImageAttr({
        id: item.product_id,
        picture_path: item.custom_image_path || item.picture_path
      });
    }
    return Utils.cachedImageAttr(item?.custom_image_path || item?.picture_path);
  },

  comboGalleryPaths(c) {
    const raw = c?.gallery_paths;
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch (_) { return []; }
    }
    return [];
  },

  comboThumbsHtml(c, limit = 12) {
    const items = c?.items || [];
    const gallery = this.comboGalleryPaths(c);
    const parts = [];
    const seen = new Set();
    const push = (attr, alt = '') => {
      if (!attr || seen.has(attr)) return;
      seen.add(attr);
      parts.push(`<img ${attr} alt="${Utils.escHtml(alt)}">`);
    };
    if (c?.id || c?.image_path || c?.picture_path) {
      push(Utils.comboImageAttr(c), c?.name || 'Combo');
    }
    gallery.forEach((p) => push(Utils.cachedImageAttr(p)));
    items.forEach((i) => {
      if (!(i.picture_path || i.custom_image_path || i.product_id)) return;
      push(this.comboItemImgAttr(i), i.product_name || '');
    });
    if (!parts.length) return '';
    return `<div class="combo-mini-thumbs">${parts.slice(0, limit).join('')}</div>`;
  },

  comboCardHtml(c, currency) {
    const items = c.items || [];
    const components = items.map(i => `${i.quantity}× ${i.product_name}`).join(', ');
    const needsOpts = this.comboNeedsOptions(c);
    const thumbs = items.filter(i => i.picture_path || i.custom_image_path || i.product_id);
    let stockBadge = '';
    if (c.combo_kind === 'custom' && c.stock_quantity != null && c.stock_quantity !== '') {
      const left = Math.max(0, Number(c.stock_quantity) || 0);
      stockBadge = `<span class="product-card-badge ${left > 0 ? '' : 'out-stock'}">${left > 0 ? `${left} available` : 'Out of stock'}</span>`;
    }
    let media;
    if (c.image_path || c.picture_path || Utils.comboImageUrl(c)) {
      media = `<img ${Utils.comboImageAttr(c)} data-image-path="${Utils.escHtml(c.image_path || c.picture_path || '')}" alt="">`;
    } else if (thumbs.length) {
      const cols = Math.min(thumbs.length, 3);
      media = `<div class="combo-item-thumbs" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px;width:100%;height:100%">
        ${thumbs.map((i) => `<img ${this.comboItemImgAttr(i)} alt="" style="width:100%;height:100%;object-fit:cover;min-height:36px">`).join('')}
      </div>`;
    } else {
      media = `<span class="product-card-placeholder">🎁</span>`;
    }
    const strip = this.comboThumbsHtml(c);
    const outOfStock = c.combo_kind === 'custom' && c.stock_quantity != null && c.stock_quantity !== ''
      && Number(c.stock_quantity) <= 0;
    return `<button class="product-card ${needsOpts ? 'has-options' : ''}${outOfStock ? ' out-of-stock' : ''}" data-combo-id="${c.id}" ${outOfStock ? 'disabled' : ''}>
      <div class="product-card-media">${media}</div>
      ${strip || ''}
      <div class="product-card-body">
        <span class="product-card-cat">COMBO</span>
        <span class="product-card-name">${c.name}</span>
        <span class="product-card-price">${Utils.formatMoney(c.final_price, currency)}</span>
        <span class="product-card-meta">${components || 'Bundle deal'}</span>
        <span class="product-card-badge">Combo</span>
        ${stockBadge || (c.combo_kind === 'custom' && (c.stock_quantity == null || c.stock_quantity === '') ? '<span class="product-card-badge">Available</span>' : '')}
        ${needsOpts ? '<span class="product-card-badge">Options first</span>' : ''}
      </div>
    </button>`;
  },

  scheduleRenderProducts(filter = '') {
    this._pendingProductFilter = filter;
    if (this._renderProductsRaf) cancelAnimationFrame(this._renderProductsRaf);
    this._renderProductsRaf = requestAnimationFrame(() => {
      this._renderProductsRaf = null;
      this.renderProducts(this._pendingProductFilter || '');
    });
  },

  bindComboGridClicks(grid) {
    grid.querySelectorAll('[data-combo-id]:not([disabled])').forEach(btn => btn.addEventListener('click', () => {
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

  /** Blocking price choice when customer opts out of pap / removal on promo or combo. */
  confirmWithoutOptionPrice(opts = {}) {
    const currency = opts.currency || this.app.settings?.currency || 'R';
    const optionName = opts.optionName || 'Without pap';
    const salePrice = Number(opts.salePrice) || 0;
    const normalPrice = Number(opts.normalPrice) || salePrice;
    const isCombo = !!opts.isCombo;
    const saleLabel = isCombo ? 'Combo deal price' : 'Sale price';
    const normalLabel = isCombo ? 'Standard combo price' : 'Normal price';
    const saleHint = isCombo ? 'Keep the combo as advertised (with pap)' : 'Keep the promotional sale price';
    const normalHint = isCombo ? 'Without pap — charged at the regular combo total' : 'Without pap — charged at the regular menu price';

    return new Promise((resolve) => {
      const host = document.getElementById('modal-overlay') || document.getElementById('modal-body');
      if (!host) return resolve(null);
      const overlay = document.createElement('div');
      overlay.className = 'pos-price-confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="pos-price-confirm-panel">
          <div class="pos-price-confirm-badge">Price confirmation required</div>
          <h4 class="pos-price-confirm-title">Confirm pricing choice</h4>
          <p class="pos-price-confirm-lead">You selected <strong>${Utils.escHtml(optionName)}</strong>.</p>
          <p class="muted pos-price-confirm-sub">Please confirm how this item should be priced before continuing.</p>
          <div class="pos-price-confirm-cards">
            <button type="button" class="pos-price-confirm-card" data-choice="sale">
              <span class="pos-price-confirm-card-label">${saleLabel}</span>
              <span class="pos-price-confirm-card-price">${Utils.formatMoney(salePrice, currency)}</span>
              <span class="pos-price-confirm-card-hint">${saleHint}</span>
            </button>
            <button type="button" class="pos-price-confirm-card pos-price-confirm-card-alt" data-choice="normal">
              <span class="pos-price-confirm-card-label">${normalLabel}</span>
              <span class="pos-price-confirm-card-price">${Utils.formatMoney(normalPrice, currency)}</span>
              <span class="pos-price-confirm-card-hint">${normalHint}</span>
            </button>
          </div>
          <p class="pos-price-confirm-foot muted">You must choose one option to continue.</p>
        </div>`;
      host.appendChild(overlay);
      const finish = (choice) => {
        overlay.remove();
        resolve(choice);
      };
      overlay.querySelector('[data-choice="sale"]')?.addEventListener('click', () => finish('sale'));
      overlay.querySelector('[data-choice="normal"]')?.addEventListener('click', () => finish('normal'));
    });
  },

  isRemovalModifier(mod) {
    return mod?.modifier_type === 'removal'
      || (Number(mod?.extra_price) < 0 && mod?.modifier_type !== 'extra' && mod?.modifier_type !== 'option');
  },

  /** Collect options/extras for a product. Returns config or null if cancelled. */
  async collectProductOptions(product, ui = {}) {
    product = await this.ensureFullProduct(product);
    const optionGroups = this.groupProductOptions(product);
    const extras = product.extras || [];
    const baseRemovals = product.removals || [];
    let effectiveRemovals = [...baseRemovals];
    if (ui.comboContext) {
      const hasPapRemoval = effectiveRemovals.some((r) =>
        /pap/i.test(String(r.name || '')) || r.modifier_type === 'removal');
      if (!hasPapRemoval) {
        effectiveRemovals.push({ name: 'Without pap', modifier_type: 'removal', extra_price: 0 });
      }
    }
    if (!ui.comboContext && !optionGroups.length && !extras.length && !effectiveRemovals.length && !product.requires_options) {
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
      const opened = Utils.showModal(title, `
        ${ui.subtitle ? `<p class="muted" style="margin-bottom:10px">${ui.subtitle}</p>` : ''}
        ${ui.galleryHtml || ''}
        ${product.picture_path ? `<div style="text-align:center;margin-bottom:12px"><img data-image-path="${product.picture_path}" style="max-height:80px;border-radius:8px"></div>` : ''}
        ${product.description ? `<p class="muted">${product.description}</p>` : ''}
        <p class="muted">Price: <strong>${product.promo_active && product.original_price
          ? `<s>${Utils.formatMoney(product.original_price, currency)}</s> ${Utils.formatMoney(product.selling_price, currency)} (sale)`
          : Utils.formatMoney(product.selling_price, currency)}</strong></p>
        ${groupHtml || '<p class="muted">Select required options to continue.</p>'}
        ${effectiveRemovals.length ? `<h4 style="margin-top:16px">${ui.comboContext ? 'Pap choice' : 'Without / Remove'}</h4>${effectiveRemovals.map((e, i) =>
          `<label class="option-choice"><input type="checkbox" class="pos-removal" data-i="${i}">
            <span>${e.name} ${priceLabel(e.extra_price)}</span></label>`).join('')}` : ''}
        ${extras.length ? `<h4 style="margin-top:16px">Extras</h4>${extras.map((e, i) =>
          `<label class="option-choice"><input type="checkbox" class="pos-extra" data-i="${i}">
            <span>${e.name} ${priceLabel(e.extra_price)}</span></label>`).join('')}` : ''}`,
        `<button class="btn btn-ghost" id="pos-opt-cancel">Cancel</button>
         <button class="btn btn-primary" id="pos-add-configured">${submitLabel}</button>`,
        { noDismiss: true, force: true });
      if (opened === false) {
        Utils.toast('Close the other screen first, then add the combo', 'error');
        resolve(null);
        return;
      }
      Utils.hydrateImages(document.getElementById('modal-body'));

      const needsPriceConfirm = (ui.comboContext || product.promo_active) && effectiveRemovals.length;
      const salePrice = ui.comboContext
        ? Number(ui.comboContext.salePrice) || 0
        : Number(product.selling_price) || 0;
      const normalPrice = ui.comboContext
        ? Number(ui.comboContext.normalPrice) || salePrice
        : Number(product.original_price ?? product.selling_price) || 0;

      const bindRemovalConfirm = (cb) => {
        cb.addEventListener('change', async () => {
          if (!cb.checked) {
            delete cb.dataset.priceConfirmed;
            return;
          }
          cb.checked = false;
          const removal = effectiveRemovals[parseInt(cb.dataset.i, 10)];
          const choice = await this.confirmWithoutOptionPrice({
            optionName: removal?.name || 'Without pap',
            salePrice,
            normalPrice,
            isCombo: !!ui.comboContext,
            currency
          });
          if (choice === 'normal') {
            cb.checked = true;
            cb.dataset.priceConfirmed = '1';
          } else if (choice === 'sale') {
            cb.checked = false;
            cb.dataset.priceConfirmed = 'sale';
          } else {
            cb.checked = false;
            delete cb.dataset.priceConfirmed;
          }
        });
      };

      if (needsPriceConfirm) {
        document.querySelectorAll('.pos-removal').forEach(bindRemovalConfirm);
      }

      document.getElementById('pos-opt-cancel')?.addEventListener('click', () => finish(null));
      document.getElementById('pos-add-configured')?.addEventListener('click', async () => {
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
            document.querySelectorAll('.option-group-block').forEach((el, idx) => {
              el.classList.toggle('pos-opt-missing', idx === gi);
            });
            document.querySelectorAll('.option-group-block')[gi]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        if (needsPriceConfirm) {
          for (const cb of document.querySelectorAll('.pos-removal:checked')) {
            if (cb.dataset.priceConfirmed === '1') continue;
            const removal = effectiveRemovals[parseInt(cb.dataset.i, 10)];
            const choice = await this.confirmWithoutOptionPrice({
              optionName: removal?.name || 'Without pap',
              salePrice,
              normalPrice,
              isCombo: !!ui.comboContext,
              currency
            });
            if (choice === 'normal') {
              cb.checked = true;
              cb.dataset.priceConfirmed = '1';
            } else {
              cb.checked = false;
              delete cb.dataset.priceConfirmed;
            }
          }
        }
        const confirmedRemovals = [...document.querySelectorAll('.pos-removal:checked')].map(cb => effectiveRemovals[parseInt(cb.dataset.i, 10)]).filter(Boolean);
        const selectedExtras = [...document.querySelectorAll('.pos-extra:checked')].map(cb => extras[parseInt(cb.dataset.i, 10)]).filter(Boolean);
        finish({ selectedOptions, selectedExtras: [...confirmedRemovals, ...selectedExtras] });
      });
    });
  },

  async configureAndAddCombo(combo) {
    if (!this.requireShift('adding items')) return;
    const items = combo.items || [];
    if (!items.length) return Utils.toast('This combo has no items', 'error');

    if (combo.combo_kind === 'custom') {
      if (combo.stock_quantity != null && combo.stock_quantity !== '' && Number(combo.stock_quantity) <= 0) {
        return Utils.toast(`${combo.name} is out of stock`, 'error');
      }
      const configured = items.map((item) => ({
        product_id: item.product_id || null,
        product_name: item.product_name || item.custom_name || 'Item',
        quantity: Number(item.quantity) || 1,
        modifiers: [],
        modifiers_text: null
      }));
      this.addComboToCart(combo, configured);
      Utils.toast(`Added ${combo.name}`, 'success');
      return;
    }

    const resolved = [];
    for (const item of items) {
      if (!item.product_id) continue;
      const product = await this.resolveComboProduct(item);
      if (!product) {
        return Utils.toast(`Combo item missing from products (id ${item.product_id})`, 'error');
      }
      resolved.push({
        item,
        product,
        needsOptions: item.allow_pap_choice || this.productNeedsDialog(product)
      });
    }
    if (!resolved.length) return Utils.toast('This combo has no valid products', 'error');

    const optionSteps = resolved.filter(r => r.needsOptions).length;
    let optionStep = 0;
    const configured = [];

    for (const row of resolved) {
      const { item, product, needsOptions } = row;
      if (needsOptions) {
        optionStep += 1;
        const config = await this.collectProductOptions(product, {
          title: `${combo.name} — ${product.name}`,
          subtitle: item.allow_pap_choice
            ? `Choose with or without pap (${optionStep} of ${optionSteps})`
            : `Fill options for this combo item first (${optionStep} of ${optionSteps}), then continue.`,
          submitLabel: optionStep < optionSteps ? 'Next item →' : 'Add Combo to Order',
          galleryHtml: this.comboThumbsHtml(combo),
          comboContext: item.allow_pap_choice ? {
            salePrice: combo.final_price,
            normalPrice: combo.normal_price
          } : null
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
    if (this.selectedCategory == null || this.selectedCategory === '' || String(this.selectedCategory) === '__all') {
      this.ensureDefaultCategory();
    }
    const catKey = this._resolveCategoryKey(this.selectedCategory || this.defaultCategoryKey());
    this.selectedCategory = catKey;
    const combosOnly = catKey === 'combos';
    const cacheKey = this._productGridCacheKey(catKey, filter);
    if (!filter && this._productGridCache && this._productGridCache.has(cacheKey)) {
      grid.innerHTML = this._productGridCache.get(cacheKey);
      Utils.hydrateImages(grid);
      this.bindComboGridClicks(grid);
      this.setActiveCategoryTab(catKey);
      this.prefetchVisibleProductOptions();
      return;
    }
    const combos = combosOnly ? this.combosForView('combos', filter) : [];
    if (combosOnly) {
      const comboHtml = combos.map(c => this.comboCardHtml(c, currency)).join('')
        || '<p class="muted" style="padding:24px;text-align:center">No active combos</p>';
      grid.innerHTML = comboHtml;
      if (!filter) {
        if (!this._productGridCache) this._productGridCache = new Map();
        this._productGridCache.set(cacheKey, comboHtml);
      }
      this.bindComboGridClicks(grid);
      Utils.hydrateImages(grid);
      this.setActiveCategoryTab(catKey);
      return;
    }
    let items = filter ? (this.products || []) : this._productsForCategory(catKey);
    if (filter) {
      const q = filter.toLowerCase();
      items = items.filter(p => p.name.toLowerCase().includes(q) || p.barcode?.includes(q) || p.sku?.toLowerCase().includes(q));
    }
    const comboHtml = combosOnly ? combos.map(c => this.comboCardHtml(c, currency)).join('') : '';
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
      const showImg = !!(p.id && (p._hasImage || p.picture_path || Utils.productImageUrl(p) || Utils.isCloudPos()));
      return `<button class="product-card ${stockClass} ${hasOpts ? 'has-options' : ''} ${p.promo_active ? 'promo-active' : ''}" data-id="${p.id}" title="${st.oosReason || (st.limiting ? `Limited by ${st.limiting}` : '')}">
        <div class="product-card-media">${showImg
          ? `<img ${Utils.productImageAttr(p)} alt="${Utils.escHtml((p.name || '?').charAt(0).toUpperCase())}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'product-card-placeholder',textContent:this.alt||'?'}))">`
          : `<span class="product-card-placeholder">${(p.name || '?').charAt(0).toUpperCase()}</span>`}</div>
        <div class="product-card-body">
          ${cat ? `<span class="product-card-cat">${cat.name}</span>` : ''}
          <span class="product-card-name">${p.name}</span>
          <span class="product-card-price${p.promo_active ? ' promo-price' : ''}">${p.promo_active && p.original_price ? `<s class="was-price">${Utils.formatMoney(p.original_price, currency)}</s> ` : ''}${Utils.formatMoney(p.selling_price, currency)}</span>
          <span class="product-card-meta">${availLabel}${p.sku && !st.isMeal ? ` · ${p.sku}` : ''}</span>
          ${promoBadge}${mealBadge}
          ${hasOpts ? '<span class="product-card-badge">Customise</span>' : ''}
        </div>
      </button>`;
    }).join('');
    const html = (comboHtml + productHtml) || '<p class="muted" style="padding:24px;text-align:center">No products in this category</p>';
    grid.innerHTML = html;
    if (!filter) {
      if (!this._productGridCache) this._productGridCache = new Map();
      this._productGridCache.set(cacheKey, html);
    }
    Utils.hydrateImages(grid);
    this.bindComboGridClicks(grid);
    this.setActiveCategoryTab(catKey);
    this.prefetchVisibleProductOptions();
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
      container.innerHTML = '<p class="cart-empty">Tap a product to add</p>';
    } else {
      container.innerHTML = this.cart.map((item, i) => `
        <div class="cart-item">
          <div>
            <div class="item-name">${item.product_name}</div>
            ${item.modifiers_text ? `<div class="muted" style="font-size:11px">${item.modifiers_text}</div>` : ''}
            <div class="item-price">${Utils.formatMoney(item.unit_price, currency)} each</div>
          </div>
          <div class="qty-control">
            <button type="button" data-action="minus" data-idx="${i}" aria-label="Decrease">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-action="plus" data-idx="${i}" aria-label="Increase">+</button>
          </div>
          <div class="cart-item-total">
            <strong>${Utils.formatMoney(item.total, currency)}</strong>
            <button type="button" class="cart-item-remove" data-action="remove" data-idx="${i}" aria-label="Remove">×</button>
          </div>
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
    this.recalcDeliveryFee(grossSubtotal);
    const deliveryFee = this.orderType === 'delivery' ? (Number(this.deliveryFee) || 0) : 0;
    const deliveryRow = document.getElementById('cart-delivery-fee-row');
    const deliveryEl = document.getElementById('cart-delivery-fee');
    if (deliveryRow && deliveryEl) {
      const showDel = this.orderType === 'delivery';
      deliveryRow.classList.toggle('hidden', !showDel);
      const placeName = this.deliveryPlace?.name ? ` (${this.deliveryPlace.name})` : '';
      const label = deliveryRow.querySelector('span:first-child');
      if (label) label.textContent = `Delivery fee${placeName}`;
      deliveryEl.textContent = Utils.formatMoney(deliveryFee, currency);
    }
    const grandTotal = totals.total + deliveryFee;
    document.getElementById('cart-total').textContent = Utils.formatMoney(grandTotal, currency);
    this.totals = { subtotal: totals.subtotalExcl, grossSubtotal, discount: this.discount, tax_amount: totals.tax, delivery_fee: deliveryFee, total: grandTotal };
    this.broadcastCartToDisplays(grandTotal, currency);
    this.updateLoyaltyDisplay(grandTotal);
    this.updateProductStockDisplay();
    this.updateMobileDock(grandTotal, currency);
  },

  updateMobileDock(total, currency) {
    const cur = currency || this.app.settings?.currency || 'R';
    const totEl = document.getElementById('pos-mobile-cart-total');
    const cntEl = document.getElementById('pos-mobile-cart-count');
    const items = (this.cart || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    if (totEl) totEl.textContent = Utils.formatMoney(total ?? 0, cur);
    if (cntEl) {
      cntEl.textContent = String(items);
      cntEl.classList.toggle('hidden', items === 0);
    }
  },

  setMobilePanel(panel) {
    const root = this._host?.querySelector?.('.pos-till') || document.querySelector('.pos-till');
    if (!root) return;
    const showMenu = panel !== 'cart';
    root.classList.toggle('pos-mobile-show-menu', showMenu);
    root.classList.toggle('pos-mobile-show-cart', !showMenu);
    root.querySelectorAll('.pos-mobile-dock-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.posPanel === (showMenu ? 'menu' : 'cart'));
    });
  },

  bindMobileDock() {
    const dock = document.getElementById('pos-mobile-dock');
    if (!dock || dock.dataset.bound === '1') return;
    dock.dataset.bound = '1';
    dock.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pos-panel]');
      if (!btn) return;
      this.setMobilePanel(btn.dataset.posPanel);
    });
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => {
      const root = document.querySelector('.pos-till');
      if (!root) return;
      if (mq.matches) {
        if (!root.classList.contains('pos-mobile-show-menu') && !root.classList.contains('pos-mobile-show-cart')) {
          this.setMobilePanel('menu');
        }
      } else {
        root.classList.remove('pos-mobile-show-menu', 'pos-mobile-show-cart');
      }
    };
    sync();
    mq.addEventListener?.('change', sync);
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
      btn.textContent = this.scanMode ? 'Scanning…' : 'Scan';
    }
    banner?.classList.toggle('hidden', !this.scanMode);
    if (this.scanMode && search) {
      search.placeholder = this._preferCameraScan ? 'Camera scan or type barcode…' : 'Scan barcode now…';
      search.focus();
      search.select();
      if (this._preferCameraScan) this.startCameraBarcodeScan();
    } else if (search) {
      search.placeholder = 'Search products or scan barcode…';
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
    const allMods = [...opts, ...extras];
    const extraTotal = allMods.reduce((s, m) => s + (Number(m.extra_price) || 0), 0);
    const modText = allMods.map(m => m.name).join(', ');
    const priced = this.calcPromoUnitPrice(product, allMods);
    const unitPrice = priced.unitPrice;
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
        modifiers: allMods,
        substitutions: substitutions || null,
        promo_request_id: priced.optedOut ? null : (product.promo_request_id || null),
        original_unit_price: priced.optedOut ? null : (product.promo_active
          ? (Number(product.original_price ?? product.selling_price) || 0)
          : null)
      });
    }
    this.renderCart();
    if (window.matchMedia('(max-width: 767px)').matches) {
      this.setMobilePanel('cart');
    }
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
    const hasRemoval = components.some((c) => (c.modifiers || []).some((m) => this.isRemovalModifier(m)));
    const comboSale = Number(combo.final_price) || 0;
    const comboNormal = Number(combo.normal_price) || comboSale;
    const unitPrice = hasRemoval ? comboNormal : comboSale;
    const normalPrice = comboNormal;
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
        combo_components: components,
        combo_price_opted_out: hasRemoval || undefined
      });
    }
    this.renderCart();
    if (window.matchMedia('(max-width: 767px)').matches) {
      this.setMobilePanel('cart');
    }
  },

  async promptProductOptions(product) {
    const config = await this.collectProductOptions(product);
    if (!config) return;
    const full = this.products.find((p) => p.id == product.id) || product;
    this.addToCart(full, config);
  },

  bindEvents(el) {
    this.bindMobileDock();
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
      if (!tab || tab.classList.contains('active')) return;
      let nextCat = tab.dataset.cat || this.defaultCategoryKey();
      if (String(nextCat) === '__all') nextCat = this.defaultCategoryKey();
      if (String(this.selectedCategory) === String(nextCat)) return;
      this.selectedCategory = nextCat;
      this.setActiveCategoryTab(nextCat);
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
      this.cart = []; this.discount = 0; this.loadedQuoteId = null;
      this.clearCustomer();
      this.renderCart();
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
        return;
      }
      Utils.showModal('Refund', '<p class="muted" style="margin:0">Opening refund form…</p>', '<button class="btn btn-ghost" id="pos-refund-load-close">Close</button>');
      document.getElementById('pos-refund-load-close')?.addEventListener('click', () => Utils.hideModal());
      this.app?.ensurePageScripts?.('returns')?.then(() => {
        Utils.hideModal();
        if (window.ReturnsPage?.showReturnForm) {
          ReturnsPage.app = this.app;
          ReturnsPage.showReturnForm(receipt, this.app);
        } else Utils.toast('Refund module unavailable — refresh and try again', 'error');
      }).catch(() => {
        Utils.hideModal();
        Utils.toast('Could not load refund module', 'error');
      });
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
    document.getElementById('pos-taken')?.addEventListener('click', () => this.showTakenPayLater());
    document.getElementById('pos-taken-list')?.addEventListener('click', () => this.showUnpaidTakenOrders());
    document.getElementById('pos-free-tables')?.addEventListener('click', () => this.showFreeTablePicker());
    document.getElementById('pos-today-target')?.addEventListener('click', () => {
      this.closeMoreOverlay?.();
      this.showTodayTargetModal();
    });
    this.bindReferralCodeTypeahead();
    this.refreshTakenCountBadge();
  },

  bindReferralCodeTypeahead() {
    const input = document.getElementById('pos-referral-code');
    const drop = document.getElementById('pos-referral-dropdown');
    const hint = document.getElementById('pos-referral-hint');
    const clearBtn = document.getElementById('pos-referral-clear');
    if (!input || input.dataset.refBound) return;
    input.dataset.refBound = '1';
    let timer = null;
    this.referralCleared = false;
    const hide = () => drop?.classList.add('hidden');
    const clearReferral = async () => {
      input.value = '';
      this.referralCleared = true;
      hide();
      if (hint) hint.textContent = 'Referral removed from this order — customer account kept';
      // Do NOT clear sticky customer→agent attribution globally — only this order
    };
    clearBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearReferral();
    });
    const pick = (row) => {
      input.value = String(row.code || '').toUpperCase();
      this.referralCleared = false;
      if (hint) hint.textContent = row.agent_name ? `Order under: ${row.agent_name}` : '';
      hide();
    };
    const run = async () => {
      const q = String(input.value || '').trim();
      if (!q) {
        hide();
        if (hint) hint.textContent = this.referralCleared ? 'Referral removed from this order — customer account kept' : '';
        return;
      }
      this.referralCleared = false;
      let rows = [];
      try {
        const res = await API.referralSearchCodes(q);
        rows = res?.data || res || [];
        if (!Array.isArray(rows)) rows = [];
      } catch (_) {
        try {
          const v = await API.referralValidateCode(q);
          const data = v?.data || v;
          if (data?.code && !data.error) rows = [data];
        } catch (__) { rows = []; }
      }
      if (!drop) return;
      if (!rows.length) {
        drop.innerHTML = '<div class="search-item muted">No matching referral agent</div>';
        drop.classList.remove('hidden');
        if (hint) hint.textContent = '';
        return;
      }
      drop.innerHTML = rows.map((r) =>
        `<div class="search-item" data-code="${Utils.escHtml(r.code)}" data-name="${Utils.escHtml(r.agent_name || '')}">
          <strong>${Utils.escHtml(r.code)}</strong> — ${Utils.escHtml(r.agent_name || 'Agent')}
        </div>`
      ).join('');
      drop.classList.remove('hidden');
      drop.querySelectorAll('.search-item[data-code]').forEach((el) => {
        el.addEventListener('click', () => pick({ code: el.dataset.code, agent_name: el.dataset.name }));
      });
      if (rows.length === 1 && String(rows[0].code || '').toUpperCase() === q.toUpperCase()) {
        if (hint) hint.textContent = rows[0].agent_name ? `Order under: ${rows[0].agent_name}` : '';
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      if (!String(input.value || '').trim()) {
        this.referralCleared = true;
        if (hint) hint.textContent = 'Referral removed from this order — customer account kept';
        hide();
        return;
      }
      timer = setTimeout(run, 180);
    });
    input.addEventListener('blur', () => setTimeout(hide, 200));
    input.addEventListener('focus', () => { if (input.value.trim()) run(); });
  },

  prefetchPosProductImages() {
    const products = this.products || [];
    if (!products.length) return;
    try {
      window.OfflineStore?.prefetchProductImages?.(products, { limit: 64 });
    } catch (_) { /* ignore */ }
    // Warm URL cache for first screen of cards
    const first = products.slice(0, 48);
    first.forEach((p) => {
      const url = Utils.productImageUrl?.(p);
      if (url && p.picture_path) Utils._imageUrlCache.set(String(p.picture_path), url);
    });
    const grid = document.getElementById('pos-grid');
    if (grid) Utils.hydrateImages(grid);
  },

  async showTakenPayLater() {
    if (!this.requireShift('Taken – Pay Later')) return;
    if (!this.cart.length) return Utils.toast('Cart is empty', 'error');
    if (!this.totals?.total && this.totals?.total !== 0) this.renderCart();
    const currency = this.app.settings?.currency || 'R';
    const total = Number(this.totals?.total) || 0;
    const itemsHtml = this.cart.map((i) =>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border)">${i.quantity}× ${Utils.escHtml(i.product_name)} — ${Utils.formatMoney(i.total, currency)}</div>`
    ).join('');

    const role = this.app.user?.role;
    const selfOk = ['owner', 'manager', 'assistant_manager', 'supervisor'].includes(role);
    let managerPin = null;
    if (!selfOk) {
      managerPin = await this.promptSaleManagerPin('Taken – Pay Later requires manager or supervisor approval.');
      if (!managerPin) return;
    }

    let cust = this.selectedCustomer?.id ? this.selectedCustomer : null;
    const pickCustomerFast = async () => new Promise((resolve) => {
      Utils.showModal('Select saved customer', `
        <p class="muted">Taken – Pay Later is only for customers already in the system. Search by name or phone.</p>
        <div class="field"><label>Search</label>
          <input type="search" id="pos-taken-cust-q" placeholder="Name or phone…" autocomplete="off" autofocus></div>
        <div id="pos-taken-cust-results" style="max-height:220px;overflow:auto;margin-top:8px"></div>
        <p id="pos-taken-cust-err" class="error-msg hidden"></p>`,
        '<button class="btn btn-ghost" id="pos-taken-cust-cancel">Cancel</button>');
      document.getElementById('pos-taken-cust-cancel')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve(null);
      });
      const box = document.getElementById('pos-taken-cust-results');
      const err = document.getElementById('pos-taken-cust-err');
      let timer = null;
      const run = async () => {
        const q = String(document.getElementById('pos-taken-cust-q')?.value || '').trim();
        if (q.length < 1) {
          if (box) box.innerHTML = '<p class="muted">Type to search saved customers…</p>';
          return;
        }
        if (box) box.innerHTML = '<p class="muted">Searching…</p>';
        try {
          const res = await API.getCustomers(q);
          const list = (res?.data || res || []).filter((c) => c?.id && String(c.phone || '').trim());
          if (!list.length) {
            if (box) box.innerHTML = '<p class="muted">No saved customers with a phone match.</p>';
            return;
          }
          if (box) {
            box.innerHTML = list.slice(0, 20).map((c) => `
              <button type="button" class="btn btn-ghost btn-block" data-taken-cust="${c.id}"
                style="text-align:left;margin-bottom:4px">
                <strong>${Utils.escHtml(c.name || c.full_name || 'Customer')}</strong>
                <span class="muted"> · ${Utils.escHtml(c.phone || '')}</span>
              </button>`).join('');
            box.querySelectorAll('[data-taken-cust]').forEach((b) => {
              b.addEventListener('click', () => {
                const found = list.find((c) => String(c.id) === String(b.dataset.takenCust));
                Utils.hideModal();
                resolve(found || null);
              });
            });
          }
        } catch (e) {
          if (err) { err.textContent = e?.message || 'Search failed'; err.classList.remove('hidden'); }
        }
      };
      document.getElementById('pos-taken-cust-q')?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(run, 180);
      });
      run();
    });

    if (!cust?.id) {
      cust = await pickCustomerFast();
      if (!cust?.id) return;
      this.selectCustomer(cust);
    }
    if (!String(cust.phone || '').trim()) {
      return Utils.toast('Selected customer has no phone number on file — update the customer first.', 'error');
    }

    Utils.showModal('TAKEN – PAY LATER', `
      <p class="muted">Only saved customers. Stock leaves now. Not cash revenue until paid.</p>
      <div style="padding:10px 12px;background:var(--surface,#f8fafc);border-radius:10px;margin:8px 0;border:1px solid var(--border)">
        <strong>${Utils.escHtml(cust.name || cust.full_name || 'Customer')}</strong>
        <div class="muted">${Utils.escHtml(cust.phone || '')}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="pos-taken-change-cust" style="margin-top:6px">Change customer</button>
      </div>
      <div style="max-height:120px;overflow:auto;margin:8px 0">${itemsHtml}</div>
      <p><strong>Amount owed:</strong> ${Utils.formatMoney(total, currency)}</p>
      <p class="muted" style="font-size:12px">${selfOk ? 'Approved by you' : 'Manager PIN verified'}</p>
      <p id="pos-taken-err" class="error-msg hidden"></p>`,
      '<button class="btn btn-ghost" id="pos-taken-cancel">Cancel</button><button class="btn btn-warning" id="pos-taken-save">Confirm TAKEN</button>');
    document.getElementById('pos-taken-cancel')?.addEventListener('click', Utils.hideModal);
    document.getElementById('pos-taken-change-cust')?.addEventListener('click', async () => {
      Utils.hideModal();
      this.selectedCustomer = null;
      await this.showTakenPayLater();
    });
    document.getElementById('pos-taken-save')?.addEventListener('click', async () => {
      const err = document.getElementById('pos-taken-err');
      const showErr = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
      err?.classList.add('hidden');
      const btn = document.getElementById('pos-taken-save');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        const tillBranchId = await API.getTillBranchId?.().catch(() => null);
        const order_summary = this.cart.map((i) => `${i.quantity}× ${i.product_name}`).join(', ');
        const saleData = {
          till_branch_id: tillBranchId || undefined,
          branch_id: tillBranchId || this.app.user?.branch_id || undefined,
          device_id: Utils.getDeviceId?.() || undefined,
          items: this.cart.map((i) => ({
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
          customer_id: cust.id,
          customer_name: cust.name || cust.full_name,
          customer_phone: cust.phone,
          subtotal: this.totals.subtotal,
          discount: this.totals.discount,
          discount_authorized: !!(this.discountApprover || (this.totals.discount > 0 && ['owner', 'manager'].includes(role))),
          discount_approver_id: this.discountApprover?.id || null,
          discount_manager_pin: this.totals.discount > 0.02 ? this.discountManagerPin : null,
          manager_pin: managerPin || undefined,
          taken_requires_approval: !selfOk,
          tax_amount: this.totals.tax_amount,
          total,
          amount_paid: total,
          change_amount: 0,
          payments: [{ type: 'taken', amount: total }],
          taken_order: {
            customer_id: cust.id,
            customer_name: cust.name || cust.full_name,
            phone: cust.phone,
            order_summary,
            notes: 'Taken – Pay Later'
          },
          order_type: this.orderType || 'takeaway',
          table_id: this.selectedTable?.id || null,
          table_name: this.selectedTable?.name || null,
          notes: `TAKEN–PAY LATER · ${cust.name || ''} · ${cust.phone || ''}`
        };
        let res = await API.completeSale(saleData, this.app.user);
        if (!res.success && /Manager PIN required/i.test(res.error || '')) {
          const pin = await this.promptSaleManagerPin(res.error);
          if (!pin) throw new Error(res.error || 'Manager PIN required');
          saleData.manager_pin = pin;
          res = await API.completeSale(saleData, this.app.user);
        }
        if (!res.success) throw new Error(res.error || 'Could not record taken order');
        Utils.hideModal();
        this.applyLocalSaleStockDeduction(this.cart);
        this.cart = [];
        this.discount = 0;
        this.discountApprover = null;
        this.discountManagerPin = null;
        this.renderCart();
        Utils.toast(`Taken · ${cust.name} owes ${Utils.formatMoney(total, currency)}`, 'success');
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm TAKEN'; }
        showErr(e?.message || 'Failed');
      }
    });
  },

  async showUnpaidTakenOrders() {
    if (!this.requireShift('viewing unpaid taken orders')) return;
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal('UNPAID / TAKEN ORDERS', '<p class="muted">Loading…</p>',
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    let rows = [];
    try {
      const res = await API.listTakenOrders({ status: 'UNPAID', limit: 100 }, this.app.user);
      const list = res?.data || res || [];
      rows = Array.isArray(list) ? list : [];
    } catch (err) {
      Utils.showModal('UNPAID / TAKEN ORDERS',
        `<p class="error-msg">${Utils.escHtml(err?.message || 'Could not load unpaid orders')}</p>`,
        '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
      return;
    }
    this._updateTakenCountBadge(rows.length);
    if (!rows.length) {
      Utils.showModal('UNPAID / TAKEN ORDERS',
        '<div style="padding:24px;text-align:center"><p class="muted" style="margin:0">No unpaid / taken orders</p></div>',
        '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
      return;
    }
    const html = rows.map((o) => {
      const when = String(o.taken_at || '').replace('T', ' ').slice(0, 16);
      return `<div class="pos-taken-card" data-taken-id="${o.id}" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <strong>${Utils.escHtml(o.customer_name || '—')}</strong>
          <strong>${Utils.formatMoney(o.amount_owed, currency)}</strong>
        </div>
        <div class="muted" style="margin:4px 0">${Utils.escHtml(o.order_summary || 'Order')}</div>
        <div class="muted" style="font-size:12px">Taken: ${Utils.escHtml(when)} · ${Utils.escHtml(o.staff_name || '')}</div>
        <div style="margin-top:6px">📞 ${Utils.escHtml(o.phone || '—')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-success btn-sm" data-taken-pay="${o.id}">PAY</button>
          <a class="btn btn-ghost btn-sm" href="tel:${Utils.escHtml(String(o.phone || '').replace(/\s/g, ''))}">CALL</a>
          <button type="button" class="btn btn-ghost btn-sm" data-taken-wa="${o.id}" data-phone="${Utils.escHtml(o.phone || '')}" data-name="${Utils.escHtml(o.customer_name || '')}">WHATSAPP</button>
        </div>
      </div>`;
    }).join('');
    Utils.showModal('UNPAID / TAKEN ORDERS', `<div style="max-height:60vh;overflow:auto">${html}</div>`,
      '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    document.querySelectorAll('[data-taken-pay]').forEach((btn) => {
      const row = rows.find((o) => Number(o.id) === Number(btn.dataset.takenPay));
      btn.addEventListener('click', () => this.payTakenOrderPrompt(Number(btn.dataset.takenPay), currency, Number(row?.amount_owed) || 0));
    });
    document.querySelectorAll('[data-taken-wa]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const phone = btn.dataset.phone || '';
        const name = btn.dataset.name || 'Customer';
        const msg = `Hi ${name}, this is ${(this.app.settings?.shop_name || 'the shop')}. Friendly reminder about your unpaid order. Thank you!`;
        const wa = await API.sendWhatsAppMessage?.({
          phone,
          recipient_name: name,
          message_type: 'general',
          body: msg
        }, this.app.user).catch(() => null);
        await Utils.deliverWhatsApp(wa, phone, msg);
      });
    });
  },

  _updateTakenCountBadge(count) {
    const badge = document.getElementById('pos-taken-count');
    if (!badge) return;
    const n = Number(count) || 0;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n <= 0);
  },

  async refreshTakenCountBadge() {
    try {
      const res = await API.listTakenOrders({ status: 'UNPAID', limit: 100 }, this.app.user);
      const list = res?.data || res || [];
      this._updateTakenCountBadge(Array.isArray(list) ? list.length : 0);
    } catch (_) { /* ignore */ }
  },

  payTakenOrderPrompt(id, currency, amountOwed = 0) {
    const total = Number(amountOwed) || 0;
    if (!(total > 0)) {
      return Utils.toast('Order amount missing', 'error');
    }
    PaymentUI.open({
      total,
      currency,
      settings: this.app.settings,
      title: `Collect Taken Order · ${Utils.formatMoney(total, currency)}`,
      confirmLabel: 'Confirm PAY',
      allowMixed: false,
      allowPartial: false,
      onConfirm: async ({ payments }) => {
        const method = payments?.[0]?.type || 'cash';
        const r = await API.payTakenOrder(id, { payment_method: method }, this.app.user);
        if (!r || r.success === false) throw new Error(r?.error || 'Payment failed');
        Utils.toast('Taken order marked PAID — recorded in POS sales', 'success');
        this.refreshTakenCountBadge();
        this.showUnpaidTakenOrders();
      }
    });
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
    Utils.showModal('Cashout History', '<p class="muted">Loading cash-outs…</p>', '<button class="btn btn-ghost" id="co-hist-close">Close</button>');
    document.getElementById('co-hist-close')?.addEventListener('click', () => Utils.hideModal());
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
    if (!Utils.hasPermission(this.app.user, 'void_sales') && !['cashier', 'manager', 'owner', 'assistant_manager', 'supervisor'].includes(this.app.user?.role)) {
      return Utils.toast('You do not have permission to void sales', 'error');
    }
    const needCode = this.app.user.role === 'cashier';
    Utils.showModal('Void Sale', `
      <p class="muted">${needCode ? 'Enter receipt number and today\'s supervisor void code from your manager (Admin → Security).' : 'Enter receipt number and reason to void a sale. Stock will be restored.'}</p>
      <div class="field"><label>Receipt Number</label><input id="void-receipt" placeholder="RCP-..." value="${Utils.escHtml(this.lastSale?.receipt_number || '')}"></div>
      <div class="field"><label>Reason</label><input id="void-reason" placeholder="Wrong item, duplicate, etc."></div>
      ${needCode ? `<div class="field"><label>Supervisor void code *</label><input type="password" id="void-super-code" maxlength="6" placeholder="Daily code from admin" autocomplete="one-time-code"></div>` : ''}`,
      '<button class="btn btn-ghost" id="void-cancel">Cancel</button><button class="btn btn-danger" id="void-confirm">Void Sale</button>');
    document.getElementById('void-cancel')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('void-confirm').addEventListener('click', async () => {
      const btn = document.getElementById('void-confirm');
      const receipt = document.getElementById('void-receipt').value.trim();
      const reason = document.getElementById('void-reason').value.trim();
      const code = document.getElementById('void-super-code')?.value.trim();
      if (!receipt || !reason) return Utils.toast('Receipt and reason required', 'error');
      if (needCode && !code) return Utils.toast('Supervisor void code required', 'error');
      if (btn) { btn.disabled = true; btn.textContent = 'Voiding…'; }
      try {
        const saleRes = await API.getSaleByReceipt(receipt);
        if (!saleRes.success || !saleRes.data) throw new Error('Receipt not found');
        const r = await API.voidSale(saleRes.data.id, reason, this.app.user, code || null);
        if (!r.success) throw new Error(r.error || 'Void failed');
        Utils.hideModal();
        Utils.toast(`Sale voided (${saleRes.data.order_number || saleRes.data.receipt_number || receipt}) — stock restored`, 'success');
        if (this.lastSale?.id === saleRes.data.id) this.lastSale = { ...this.lastSale, status: 'voided' };
        window.DataCache?.invalidate?.('salesList', 'adminDashboard');
        const prodRes = await API.getProducts({ for_pos: true, actor: this.app.user });
        this.products = prodRes.data || [];
        this.rebuildProductLookups();
        this.renderProducts();
        // Refresh POS sales list if open
        try {
          const histOpen = document.getElementById('pos-sales-date');
          if (histOpen) this.showPosSalesHistory(histOpen.value);
        } catch (_) { /* */ }
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Void Sale'; }
        Utils.toast(err.message || 'Void failed', 'error');
      }
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
      const confirmBtn = document.getElementById('co-confirm');
      if (confirmBtn?.disabled) return;
      const actualPayments = {};
      document.querySelectorAll('.co-actual').forEach(inp => {
        actualPayments[inp.dataset.method] = parseFloat(inp.value) || 0;
      });
      const shortages = {};
      for (const m of methods) {
        const expected = m === 'cash' ? preview.expectedCash : (preview.expectedPayments[m] || 0);
        shortages[m] = (actualPayments[m] || 0) - expected;
      }
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Cashing out…';
      }
      Utils.toast('Cash-out in progress…', 'info');
      try {
        const r = await API.closeShift(this.openShift.id, {
          cash_counted: actualPayments.cash || 0,
          closing_balance: actualPayments.cash || 0,
          actual_payments: actualPayments,
          payment_shortages: shortages,
          notes: document.getElementById('co-notes')?.value.trim() || ''
        }, this.app.user);
        if (!r.success) {
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Cash Out & Logout';
          }
          return Utils.toast(r.error || 'Cash-out failed', 'error');
        }
        Utils.hideModal();
        this.openShift = null;
        Utils.toast('Cash-out successful — shift closed. Goodbye!', 'success');
        setTimeout(() => {
          try { this.app.logout(); } catch (_) { /* ignore */ }
        }, 450);
      } catch (err) {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Cash Out & Logout';
        }
        Utils.toast(err?.message || 'Cash-out failed', 'error');
      }
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

  async showPosSalesHistory(selectedDate) {
    const today = Utils.today();
    const date = String(selectedDate || today).slice(0, 10) || today;
    const isToday = date === today;
    const currency = this.app.settings?.currency || 'R';
    const title = isToday ? 'POS Sales Today' : `POS Sales — ${date}`;
    Utils.showModal(title, '<p class="muted">Loading sales…</p>', '<button class="btn btn-ghost" id="pos-sales-history-close">Close</button>');
    document.getElementById('pos-sales-history-close')?.addEventListener('click', () => Utils.hideModal());

    let rows = [];
    try {
      const res = await API.getSalesList({ from: date, to: date, limit: 100, pos_only: true });
      rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    } catch (err) {
      Utils.showModal(title, `<p class="muted">${Utils.escHtml(err.message || 'Could not load sales')}</p>`,
        '<button class="btn btn-ghost" id="pos-sales-history-close">Close</button>');
      document.getElementById('pos-sales-history-close')?.addEventListener('click', () => Utils.hideModal());
      return;
    }

    const emptyMsg = isToday
      ? 'No POS sales recorded today yet.'
      : `No POS sales on ${date}.`;

    Utils.showModal(title, `
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
        <div class="field" style="margin:0;flex:1;min-width:140px">
          <label for="pos-sales-date">Date</label>
          <input type="date" id="pos-sales-date" value="${Utils.escHtml(date)}" max="${Utils.escHtml(today)}" style="width:100%">
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="pos-sales-today-btn" ${isToday ? 'disabled' : ''}>Today</button>
        <button type="button" class="btn btn-primary btn-sm" id="pos-sales-refresh">Show</button>
      </div>
      <p class="muted" style="margin:0 0 12px">Counter sales only. Tap a sale to reprint or <strong>Send Receipt</strong> on WhatsApp (same as after checkout).</p>
      <div style="max-height:420px;overflow:auto">
        ${rows.length ? rows.map((s) => {
          const otype = ({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online' })[s.order_type] || s.order_type || 'Walk-in';
          const fee = Number(s.delivery_fee) || 0;
          const place = s.delivery_place ? ` · ${s.delivery_place}` : '';
          const feeNote = s.order_type === 'delivery'
            ? (fee > 0 ? ` · Delivery ${Utils.formatMoney(fee, currency)}${place}` : ` · Delivery free${place}`)
            : '';
          const time = String(s.created_at || '').slice(11, 16) || '—';
          return `<button type="button" class="list-row pos-sale-open" data-id="${s.id}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border:0;border-bottom:1px solid var(--border);background:transparent;width:100%;text-align:left;cursor:pointer;color:inherit;font:inherit">
          <div style="min-width:0">
            <strong>${Utils.escHtml(s.order_number || s.receipt_number || `#${s.id}`)}</strong>
            ${['void', 'voided'].includes(String(s.status || '').toLowerCase())
              ? '<span style="margin-left:6px;font-size:11px;font-weight:700;color:#b91c1c;background:#fee2e2;padding:2px 6px;border-radius:999px">VOIDED</span>'
              : ''}
            <div class="muted" style="font-size:12px">${Utils.escHtml(time)} · ${Utils.escHtml(otype)}${feeNote} · ${Utils.escHtml(s.cashier_name || s.customer_name || '—')}</div>
            <div class="muted" style="font-size:12px">${Utils.escHtml(s.item_summary || '')}${s.receipt_number && s.order_number && s.receipt_number !== s.order_number ? ` · Receipt ${Utils.escHtml(s.receipt_number)}` : ''}</div>
          </div>
          <div style="text-align:right;white-space:nowrap">
            <div style="font-weight:700;${['void', 'voided'].includes(String(s.status || '').toLowerCase()) ? 'text-decoration:line-through;opacity:.7' : ''}">${Utils.formatMoney(s.total, currency)}</div>
            <div class="muted" style="font-size:11px;margin-top:4px">${['void', 'voided'].includes(String(s.status || '').toLowerCase()) ? (s.void_reason || 'Voided') : 'Tap → Send receipt'}</div>
          </div>
        </button>`;
        }).join('') : `<p class="muted">${Utils.escHtml(emptyMsg)}</p>`}
      </div>`,
      '<button class="btn btn-ghost" id="pos-sales-history-close">Close</button>');

    document.getElementById('pos-sales-history-close')?.addEventListener('click', () => Utils.hideModal());
    const reload = (d) => this.showPosSalesHistory(d);
    document.getElementById('pos-sales-refresh')?.addEventListener('click', () => {
      const d = document.getElementById('pos-sales-date')?.value || today;
      reload(d);
    });
    document.getElementById('pos-sales-today-btn')?.addEventListener('click', () => reload(today));
    document.getElementById('pos-sales-date')?.addEventListener('change', (e) => {
      const d = e.target?.value;
      if (d) reload(d);
    });
    document.querySelectorAll('.pos-sale-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        if (id) this.showPosSaleActions(id, date);
      });
    });
  },

  async showPosSaleActions(saleId, returnDate) {
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal('Sale', '<p class="muted">Loading…</p>', '<button class="btn btn-ghost" id="pos-sale-act-back">Back</button>');
    document.getElementById('pos-sale-act-back')?.addEventListener('click', () => this.showPosSalesHistory(returnDate));

    let sale;
    try {
      const saleRes = await API.getSale(saleId);
      sale = saleRes?.data || saleRes?.sale || saleRes;
      if (!sale?.id) throw new Error('Sale not found');
    } catch (err) {
      Utils.toast(err.message || 'Sale not found', 'error');
      return this.showPosSalesHistory(returnDate);
    }

    const otype = ({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online' })[sale.order_type] || sale.order_type || 'Walk-in';
    const items = (sale.items || []).map((i) =>
      `${i.quantity}× ${Utils.escHtml(Receipt.itemLabel?.(i) || i.product_name || i.name || 'Item')}`
    ).join('<br>') || Utils.escHtml(sale.item_summary || '—');
    const time = String(sale.created_at || '').replace('T', ' ').slice(0, 16);

    Utils.showModal(`Receipt #${sale.receipt_number || sale.order_number || sale.id}`, `
      <p class="muted" style="margin:0 0 8px">${Utils.escHtml(time)} · ${Utils.escHtml(otype)} · ${Utils.escHtml(sale.cashier_name || sale.customer_name || '—')}</p>
      <p style="font-size:22px;font-weight:700;margin:0 0 12px">${Utils.formatMoney(sale.total, currency)}</p>
      <div class="muted" style="font-size:13px;margin-bottom:16px;line-height:1.45">${items}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button type="button" class="btn btn-primary btn-lg" id="pos-sale-act-wa">💬 Send Receipt on WhatsApp</button>
        <button type="button" class="btn btn-ghost btn-lg" id="pos-sale-act-review">⭐ Request Review</button>
        <button type="button" class="btn btn-ghost btn-lg" id="pos-sale-act-print">🖨️ Print Receipt</button>
      </div>
    `, `<button class="btn btn-ghost" id="pos-sale-act-back">← Back to list</button>`);

    document.getElementById('pos-sale-act-back')?.addEventListener('click', () => this.showPosSalesHistory(returnDate));

    const runBtn = (id, fn, busy) => {
      const el = document.getElementById(id);
      el?.addEventListener('click', async () => {
        if (!el) return;
        el.disabled = true;
        const prev = el.textContent;
        el.textContent = busy;
        try {
          await fn();
        } catch (err) {
          Utils.toast(err.message || 'Action failed', 'error');
        } finally {
          el.disabled = false;
          el.textContent = prev;
        }
      });
    };
    runBtn('pos-sale-act-wa', () => this.resendSaleWhatsApp(sale.id), 'Sending…');
    runBtn('pos-sale-act-review', () => this.resendSaleReview(sale.id), 'Opening…');
    runBtn('pos-sale-act-print', async () => {
      await Receipt.print(sale, this.app.settings);
      Utils.toast('Sent to printer', 'success');
    }, 'Printing…');
  },

  async resendSaleWhatsApp(saleId) {
    const saleRes = await API.getSale(saleId);
    const sale = saleRes?.data || saleRes?.sale || saleRes;
    if (!sale?.id) throw new Error('Sale not found');
    const recipient = await this.ensureWhatsAppRecipient(sale);
    if (!recipient?.phone) return;
    const receiptLines = Receipt.buildWhatsAppLines(sale, this.app.settings);
    const body = this._buildReceiptWhatsAppText(sale, recipient, {
      deliveryAddress: sale.delivery_address || ''
    });
    await this._openOrSendWhatsApp({
      phone: recipient.phone,
      body,
      busyLabel: 'Opening WhatsApp…',
      doneLabel: 'WhatsApp',
      payload: {
        customer_id: recipient.id,
        recipient_type: 'customer',
        recipient_name: recipient.name,
        customer_name: recipient.name,
        receipt_lines: receiptLines,
        delivery_address: sale.delivery_address || '',
        delivery_address_line: sale.delivery_address ? `📍 Deliver to: ${sale.delivery_address}` : '',
        delivery_place: sale.delivery_place || '',
        branch: this.activeBranch?.name || this.app.settings?.shop_name,
        phone_shop: this.app.settings?.phone,
        order_number: sale.order_number || sale.receipt_number,
        receipt_number: sale.receipt_number,
        total_purchase: sale.total,
        sale_id: sale.id,
        message_type: 'sale_receipt',
        template_slug: 'sale_receipt'
      }
    });
  },

  async resendSaleReview(saleId) {
    const saleRes = await API.getSale(saleId);
    const sale = saleRes?.data || saleRes?.sale || saleRes;
    if (!sale?.id) throw new Error('Sale not found');
    const recipient = await this.ensureWhatsAppRecipient(sale);
    if (!recipient?.phone) return;
    const { orderUrl } = this._shopIdentity();
    const body = this._buildReviewWhatsAppText(sale, recipient);
    await this._openOrSendWhatsApp({
      phone: recipient.phone,
      body,
      busyLabel: 'Opening WhatsApp…',
      doneLabel: '⭐ Review',
      payload: {
        customer_id: recipient.id,
        recipient_type: 'customer',
        recipient_name: recipient.name,
        customer_name: recipient.name,
        branch: this.activeBranch?.name || this.app.settings?.shop_name,
        phone_shop: this.app.settings?.phone,
        order_number: sale.order_number || sale.receipt_number,
        receipt_number: sale.receipt_number,
        total_purchase: sale.total,
        sale_id: sale.id,
        order_url: orderUrl,
        online_order_url: orderUrl,
        message_type: 'review_request',
        template_slug: 'review_request'
      }
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
    const couponOn = this.app.settings?.discount_settings?.coupon_codes !== false;
    Utils.showModal('Apply Discount', `
      ${approver ? `<p class="muted">Approved by ${approver.full_name}</p>` : ''}
      ${couponOn ? `<div class="field"><label>Voucher / coupon code</label>
        <div style="display:flex;gap:8px">
          <input id="discount-voucher" placeholder="Enter voucher code" style="text-transform:uppercase;flex:1">
          <button type="button" class="btn btn-ghost" id="discount-voucher-apply">Apply code</button>
        </div>
        <p class="muted" id="discount-voucher-msg" style="font-size:12px;margin:6px 0 0"></p>
      </div>
      <p class="muted" style="text-align:center;margin:8px 0">— or enter amount —</p>` : ''}
      <div class="field"><label>Discount Amount (${currency})</label>
      <input type="number" id="discount-amount" min="0" step="0.01" value="${this.discount}"></div>
      <p class="muted" style="font-size:12px">Discount cannot go below profit (max ${Utils.formatMoney(maxDiscByProfit, currency)} so sale stays above cost).</p>
      ${maxPct ? `<p class="muted" style="font-size:12px">Admin max: ${maxPct}% of subtotal</p>` : ''}`,
      '<button class="btn btn-primary" id="apply-discount">Apply</button>');
    document.getElementById('discount-voucher-apply')?.addEventListener('click', async () => {
      const code = document.getElementById('discount-voucher')?.value.trim();
      if (!code) return Utils.toast('Enter a voucher code', 'error');
      const r = await API.validateDiscountVoucher(code, {
        subtotal,
        items: this.cart.map((i) => ({ product_id: i.product_id, total: i.total, quantity: i.quantity, price: i.price })),
        customerId: this.selectedCustomer?.id || null
      });
      const msg = document.getElementById('discount-voucher-msg');
      if (!r.success || r.data?.error || !r.data?.ok) {
        if (msg) msg.textContent = r.data?.error || r.error || 'Invalid voucher';
        return Utils.toast(r.data?.error || r.error || 'Invalid voucher', 'error');
      }
      const amount = Number(r.data.discount) || 0;
      document.getElementById('discount-amount').value = amount;
      this._pendingVoucher = { code: r.data.code, ...r.data };
      if (msg) msg.textContent = r.data.message || `Applied ${Utils.formatMoney(amount, currency)}`;
      Utils.toast(r.data.message || 'Voucher applied', 'success');
    });
    document.getElementById('apply-discount').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('discount-amount').value) || 0;
      if (maxPct && subtotal > 0 && amount > subtotal * maxPct / 100) {
        return Utils.toast(`Discount cannot exceed ${maxPct}%`, 'error');
      }
      if (amount > maxDiscByProfit + 0.02) {
        return Utils.toast(`Discount would sell below cost. Max allowed: ${Utils.formatMoney(maxDiscByProfit, currency)}`, 'error');
      }
      this.discount = amount;
      this.discountApprover = approver || null;
      if (this._pendingVoucher?.code && amount > 0) {
        const redeemed = await API.redeemDiscountVoucher(this._pendingVoucher.code, {
          subtotal,
          items: this.cart.map((i) => ({ product_id: i.product_id, total: i.total })),
          customerId: this.selectedCustomer?.id || null,
          channel: 'pos'
        }, this.app.user).catch(() => ({ success: false }));
        if (redeemed.success === false && redeemed.error) {
          Utils.toast(redeemed.error, 'error');
        }
        this.discountVoucherCode = this._pendingVoucher.code;
        this._pendingVoucher = null;
      }
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
      this._invalidateProductGridCache();
      this.rebuildProductLookups();
      if (product.category_id && !this.categories.find(c => c.id === product.category_id)) {
        const cats = await API.getCategories({ for_pos: true, actor: this.app.user });
        this.categories = cats.data || cats || this.categories;
      }
      this.renderCategoryTabs(this.selectedCategory || '');
      this.renderProducts(document.getElementById('pos-search')?.value || '');
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

  _prefetchPosTools() {
    if (this._posToolsPrefetch) return;
    this._posToolsPrefetch = true;
    Promise.all([
      API.getHeldOrders?.().then((r) => { this._heldOrdersCache = r?.data || r || []; }).catch(() => {}),
      API.getTables?.().then((r) => { this._tablesCache = r?.data || r || []; this._tablesCacheAt = Date.now(); }).catch(() => {}),
      this._prefetchTodayTarget?.()
    ]);
    this.app?.ensureFeatureScript?.('js/online-orders-widget.js').then(() => {
      window.OnlineOrdersWidget?.bind?.(this.app);
    }).catch(() => {});
    this.app?.ensurePageScripts?.('returns').catch(() => {});
  },

  _prefetchTodayTarget() {
    const branchId = this.app?.user?.branch_id || null;
    return API.getTodayTargetProgress?.(branchId).then((r) => {
      if (r?.success === false) return;
      this._targetProgressCache = { at: Date.now(), data: r?.data || r };
    }).catch(() => {});
  },

  async showTablePicker(opts = {}) {
    const required = !!opts.required;
    const onSelected = typeof opts.onSelected === 'function' ? opts.onSelected : null;
    const paint = (tables) => {
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
          const occ = !!t.is_occupied || String(t.status) === 'occupied';
          return `<button type="button" class="btn ${occ ? 'btn-ghost' : 'btn-primary'} pos-table-opt" data-id="${t.id}" data-name="${t.table_number}"
            data-occupied="${occ ? '1' : '0'}"
            style="padding:12px;${occ ? 'opacity:0.45;border-color:var(--warning);cursor:not-allowed' : ''}"
            ${occ ? 'disabled title="Occupied — free the table first"' : ''}>
            ${t.table_number}<br><small>${occ ? 'occupied' : t.seats + ' seats'}</small></button>`;
        }).join('')}
      </div>
      ${!tables.some(t => !(t.is_occupied || String(t.status) === 'occupied')) ? '<p class="muted" style="margin-top:12px;color:var(--warning)">No available tables. Use Free Table when guests leave.</p>' : ''}`,
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
    };

    const cached = Array.isArray(this._tablesCache) ? this._tablesCache : [];
    if (cached.length) paint(cached);
    else Utils.showModal(required ? 'Select Sit-in Table *' : 'Select Table', '<p class="muted">Loading tables…</p>', '<button class="btn btn-ghost" id="table-close">Close</button>');

    const res = await API.getTables();
    const tables = res?.data || res || [];
    this._tablesCache = tables;
    this._tablesCacheAt = Date.now();
    paint(tables);
  },

  async showFreeTablePicker() {
    this.closeMoreOverlay?.();
    const paintOccupied = (allTables) => {
      const tables = (allTables || []).filter((t) => t.is_occupied || String(t.status) === 'occupied');
      if (!tables.length) {
        Utils.hideModal();
        return Utils.toast('No occupied tables', 'success');
      }
      Utils.showModal('Mark Table Available', `
      <p class="muted" style="margin-bottom:10px">When guests leave, mark the table available for the next sit-in.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
        ${tables.map((t) => `<button type="button" class="btn btn-warning pos-free-opt" data-id="${t.id}" data-name="${Utils.escHtml(t.table_number)}"
          style="padding:14px">
          ${Utils.escHtml(t.table_number)}<br><small>occupied — free now</small></button>`).join('')}
      </div>`,
      '<button class="btn btn-ghost" id="free-table-close">Close</button>');
      document.getElementById('free-table-close')?.addEventListener('click', Utils.hideModal);
      document.querySelectorAll('.pos-free-opt').forEach((btn) => btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const name = btn.dataset.name;
        btn.disabled = true;
        btn.innerHTML = `${Utils.escHtml(name)}<br><small>Freeing…</small>`;
        // Optimistic: mark free in cache immediately
        if (Array.isArray(this._tablesCache)) {
          this._tablesCache = this._tablesCache.map((t) =>
            Number(t.id) === id ? { ...t, status: 'available', is_occupied: false, has_open_order: false } : t
          );
        }
        try {
          const r = API.releaseTable
            ? await API.releaseTable(id, this.app.user)
            : await API.saveTable({ id, table_number: name, seats: 4, status: 'available', waiter_id: null }, this.app.user);
          if (!r?.success && r?.error) {
            btn.disabled = false;
            btn.innerHTML = `${Utils.escHtml(name)}<br><small>occupied — free now</small>`;
            return Utils.toast(r.error || 'Could not free table', 'error');
          }
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = `${Utils.escHtml(name)}<br><small>occupied — free now</small>`;
          return Utils.toast(err?.message || 'Could not free table', 'error');
        }
        if (this.selectedTable?.id === id) {
          this.selectedTable = null;
          this.updateTableLabel();
        }
        Utils.hideModal();
        Utils.toast(`Table ${name} is now available`, 'success');
        // Refresh cache quietly for next open
        API.getTables?.().then((nr) => {
          this._tablesCache = nr?.data || [];
          this._tablesCacheAt = Date.now();
        }).catch(() => {});
      }));
    };

    const cached = Array.isArray(this._tablesCache) ? this._tablesCache : [];
    const cachedOcc = cached.filter((t) => t.is_occupied || String(t.status) === 'occupied');
    if (cachedOcc.length) {
      paintOccupied(cached);
    } else {
      Utils.showModal('Mark Table Available', '<p class="muted">Loading tables…</p>', '<button class="btn btn-ghost" id="free-table-close">Close</button>');
      document.getElementById('free-table-close')?.addEventListener('click', Utils.hideModal);
    }

    // Refresh quietly — don't block when cache already painted occupied tables
    const refresh = () => API.getTables().then((fresh) => {
      if (!fresh?.data) return;
      this._tablesCache = fresh.data;
      this._tablesCacheAt = Date.now();
      if (!cachedOcc.length) paintOccupied(fresh.data);
      else {
        const nextOcc = fresh.data.filter((t) => t.is_occupied || String(t.status) === 'occupied');
        if (nextOcc.length !== cachedOcc.length) paintOccupied(fresh.data);
      }
    }).catch(() => {
      if (!cachedOcc.length) paintOccupied(this._tablesCache || []);
    });
    if (cachedOcc.length) refresh();
    else await refresh();
  },

  async showHeldOrders() {
    Utils.showModal('Held Orders', '<p class="muted">Loading held orders…</p>', '<button class="btn btn-ghost" id="pos-held-close">Close</button>');
    document.getElementById('pos-held-close')?.addEventListener('click', () => Utils.hideModal());
    const res = this._heldOrdersCache?.length
      ? { success: true, data: this._heldOrdersCache }
      : await API.getHeldOrders();
    if (res?.data) this._heldOrdersCache = res.data;
    const orders = res?.data || res || [];
    const list = Array.isArray(orders) ? orders : [];
    const html = list.length ? list.map(o =>
      `<div class="pos-held-row" style="padding:10px;border-bottom:1px solid var(--border);cursor:pointer" data-hold-id="${o.id}">
        <strong>${Utils.escHtml(o.name || `Hold #${o.id}`)}</strong>
        <div class="muted" style="font-size:12px">${(Array.isArray(o.cart_data) ? o.cart_data : o.cart_data?.items || []).length} items · ${Utils.formatDateTime(o.created_at)}</div>
      </div>`).join('') : '<p class="muted">No held orders</p>';
    Utils.showModal('Held Orders', html, '<button class="btn btn-ghost" id="pos-held-close">Close</button>');
    document.getElementById('pos-held-close')?.addEventListener('click', () => Utils.hideModal());
    const body = document.getElementById('modal-body');
    if (!body) return;
    const onPick = async (e) => {
      const el = e.target.closest('[data-hold-id]');
      if (!el) return;
      const order = list.find(o => String(o.id) === String(el.dataset.holdId));
      if (!order) return;
      const data = order.cart_data;
      if (Array.isArray(data)) this.cart = data;
      else {
        this.cart = data?.items || [];
        this.discount = Number(data?.discount) || 0;
        if (data?.customer) this.selectCustomer(data.customer);
        this.selectedTable = data?.table || null;
        if (data?.orderType) this.orderType = data.orderType;
        if (data?.deliveryAddress) this.deliveryAddress = data.deliveryAddress;
      }
      this.renderCart();
      try { await API.deleteHeldOrder(order.id, this.app.user); } catch (_) { /* ignore */ }
      body.removeEventListener('click', onPick);
      Utils.hideModal();
      Utils.toast('Held order restored to cart', 'success');
      this.updatePosBadges?.();
    };
    body.addEventListener('click', onPick);
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
    // Re-read totals AFTER order type / delivery place so fee is included
    this.promptOrderType(() => {
      this.renderCart?.();
      const saleTotal = Number(this.totals?.total);
      if (Number.isNaN(saleTotal) || saleTotal < 0) {
        return Utils.toast('Cart total is invalid — please review items', 'error');
      }
      this.openPaymentFlow(saleTotal);
    });
  },

  promptOrderType(onContinue) {
    const selected = this.orderType || '';
    const prefAddr = this.deliveryAddress
      || this.selectedCustomer?.address
      || this.selectedCustomer?.delivery_address
      || '';
    const currency = this.app.settings?.currency || 'R';
    Utils.showModal('Order Type *', `
      <p class="muted" style="margin-bottom:12px">Select how this order will be fulfilled before payment.</p>
      <div class="form-grid">
        <label class="field full"><input type="radio" name="pos-order-type" value="delivery" ${selected === 'delivery' ? 'checked' : ''}> 🚚 Delivery</label>
        <label class="field full"><input type="radio" name="pos-order-type" value="takeaway" ${selected === 'takeaway' ? 'checked' : ''}> 🥡 Takeaway</label>
        <label class="field full"><input type="radio" name="pos-order-type" value="sit_in" ${selected === 'sit_in' ? 'checked' : ''}> 🍽️ Sit-in</label>
        <div class="field full" id="ot-addr-wrap" style="display:${selected === 'delivery' ? '' : 'none'}">
          <label>Delivery address *</label>
          <textarea id="ot-delivery-address" rows="2" placeholder="Street, suburb, city, landmarks…">${String(prefAddr || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}</textarea>
          <small class="muted">After Continue you will pick the delivery place / fee for this branch.</small>
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
    document.getElementById('ot-continue')?.addEventListener('click', async () => {
      const picked = document.querySelector('input[name="pos-order-type"]:checked')?.value;
      if (!picked) return Utils.toast('Order type is required', 'error');
      if (picked === 'delivery') {
        const addr = document.getElementById('ot-delivery-address')?.value.trim() || '';
        if (!addr) {
          document.getElementById('ot-delivery-address')?.focus();
          return Utils.toast('Enter the delivery address', 'error');
        }
        this.deliveryAddress = addr;
        try { await this.loadDeliveryFee(); } catch (_) { /* optional */ }
        this.orderType = 'delivery';
        Utils.hideModal();
        this.promptDeliveryPlace(onContinue, currency);
        return;
      }
      this.deliveryAddress = null;
      this.deliveryPlace = null;
      this.deliveryFee = 0;
      this.orderType = picked;
      this.renderCart?.();
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

  promptDeliveryPlace(onContinue, currency) {
    const cur = currency || this.app.settings?.currency || 'R';
    const places = this.deliveryPlaces || [];
    const gross = (this.cart || []).reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    if (!places.length) {
      // Fallback: use flat branch fee
      this.deliveryPlace = this.deliverySettings || { delivery_fee: 0 };
      this.recalcDeliveryFee(gross);
      this.renderCart?.();
      Utils.toast(`Delivery fee ${Utils.formatMoney(this.deliveryFee, cur)} added`, 'info');
      onContinue();
      return;
    }
    const feePreview = (p) => {
      const freeAbove = Number(p.free_delivery_above) || 0;
      const fee = Number(p.delivery_fee) || 0;
      return freeAbove > 0 && gross >= freeAbove ? 0 : fee;
    };
    Utils.showModal('Choose delivery place *', `
      <p class="muted" style="margin-bottom:10px">Select the delivery area for this branch. The fee is added to the order total.</p>
      <div id="ot-places" style="max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:8px">
        ${places.map((p) => {
          const due = feePreview(p);
          const freeNote = Number(p.free_delivery_above) > 0
            ? ` · free above ${Utils.formatMoney(p.free_delivery_above, cur)}`
            : '';
          const minNote = Number(p.min_order) > 0
            ? ` · min ${Utils.formatMoney(p.min_order, cur)}`
            : '';
          return `<label class="field full" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin:0;cursor:pointer">
            <input type="radio" name="pos-delivery-place" value="${Utils.escHtml(p.id)}" style="margin-right:8px">
            <strong>${Utils.escHtml(p.name)}</strong>
            <div class="muted" style="font-size:12px;margin-top:4px">Delivery fee: <strong>${Utils.formatMoney(due, cur)}</strong>${freeNote}${minNote}</div>
          </label>`;
        }).join('')}
      </div>`,
      '<button class="btn btn-ghost" id="ot-place-back">Back</button><button class="btn btn-primary" id="ot-place-go">Continue</button>');
    document.getElementById('ot-place-back')?.addEventListener('click', () => {
      Utils.hideModal();
      this.promptOrderType(onContinue);
    });
    document.getElementById('ot-place-go')?.addEventListener('click', () => {
      const id = document.querySelector('input[name="pos-delivery-place"]:checked')?.value;
      if (!id) return Utils.toast('Choose a delivery place', 'error');
      const place = places.find((p) => String(p.id) === String(id));
      if (!place) return Utils.toast('Invalid delivery place', 'error');
      const minOrd = Number(place.min_order) || 0;
      if (minOrd > 0 && gross < minOrd) {
        return Utils.toast(`Minimum order for ${place.name} is ${Utils.formatMoney(minOrd, cur)}`, 'error');
      }
      this.deliveryPlace = place;
      this.orderType = 'delivery';
      this.recalcDeliveryFee(gross);
      this.renderCart?.();
      Utils.hideModal();
      Utils.toast(`Delivery place ${place.name} · fee ${Utils.formatMoney(this.deliveryFee, cur)}`, 'success');
      this.selectedTable = null;
      this.updateTableLabel();
      onContinue();
    });
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
    const deliveryFee = this.orderType === 'delivery' ? (Number(this.deliveryFee) || 0) : 0;
    const itemsSubtotal = Math.max(0, Number(this.totals?.grossSubtotal ?? this.totals?.subtotal ?? (total - deliveryFee)) || 0);
    this._gcBalances = {};

    const taxEnabled = !!this.app.settings?.tax_enabled &&
      this.app.settings?.tax_show_on_pos !== 0 &&
      this.app.settings?.tax_show_on_pos !== false;
    PaymentUI.open({
      total,
      currency,
      settings: this.app.settings,
      customer: this.selectedCustomer,
      title: 'Complete Payment',
      confirmLabel: 'Complete Sale',
      itemsSubtotal,
      deliveryFee,
      deliveryPlace: this.orderType === 'delivery' ? (this.deliveryPlace?.name || null) : null,
      orderType: this.orderType || null,
      discountAmount: Number(this.totals?.discount) || 0,
      taxAmount: Number(this.totals?.tax_amount) || 0,
      taxRatePct: taxEnabled ? (Number(this.app.settings?.tax_rate) || 0) : 0,
      showTaxBreakdown: taxEnabled && (Number(this.totals?.tax_amount) || 0) > 0.009,
      gcBalancesRef: this._gcBalances,
      onAddCustomer: () => this.showAddCustomerModal(),
      onDismiss: releaseCheckout,
      onConfirm: async ({ payments, paid, change, loyaltyRedeem, loyaltyDiscount }) => {
        try {
        const tillBranchId = await API.getTillBranchId?.().catch(() => null);
        const saleData = {
          till_branch_id: tillBranchId || undefined,
          branch_id: tillBranchId || this.app.user?.branch_id || undefined,
          device_id: Utils.getDeviceId?.() || undefined,
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
          referral_code: (document.getElementById('pos-referral-code')?.value || '').trim().toUpperCase() || null,
          referral_cleared: !!this.referralCleared && !(document.getElementById('pos-referral-code')?.value || '').trim(),
          skip_referral: !!this.referralCleared && !(document.getElementById('pos-referral-code')?.value || '').trim(),
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
          delivery_fee: this.orderType === 'delivery' ? (Number(this.deliveryFee) || 0) : 0,
          delivery_place: this.orderType === 'delivery' ? (this.deliveryPlace?.name || null) : null,
          customer_name: this.selectedCustomer?.name || this.selectedCustomer?.full_name || null,
          customer_phone: this.selectedCustomer?.phone || null,
          notes: [
            this.orderType ? `Order: ${({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in' })[this.orderType] || this.orderType}` : null,
            this.orderType === 'delivery' && this.deliveryPlace?.name ? `Delivery place: ${this.deliveryPlace.name}` : null,
            this.orderType === 'delivery' && this.deliveryAddress ? `Deliver to: ${this.deliveryAddress}` : null,
            this.orderType === 'delivery' ? `Delivery fee: ${Utils.formatMoney(Number(this.deliveryFee) || 0, currency)}` : null,
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
          const cartSnapshot = (this.cart || []).map((i) => ({ ...i }));
          const offlineSale = {
            id: null,
            offline: true,
            receipt_number: 'Offline/pending',
            total: this.totals?.total ?? total,
            subtotal: this.totals?.subtotal,
            discount: this.totals?.discount,
            tax_amount: this.totals?.tax_amount,
            amount_paid: paid,
            change_amount: change,
            payments,
            customer_id: this.selectedCustomer?.id || null,
            customer_name: this.selectedCustomer?.name || this.selectedCustomer?.full_name || null,
            customer_phone: this.selectedCustomer?.phone || null,
            delivery_address: this.orderType === 'delivery' ? (this.deliveryAddress || null) : null,
            items: cartSnapshot.map((i) => ({
              product_id: i.product_id,
              product_name: i.product_name,
              quantity: i.quantity,
              unit_price: i.unit_price,
              total: i.total,
              has_recipe: !!(i.has_recipe || i.item_type === 'restaurant'),
              item_type: i.item_type || null,
              modifiers_text: i.modifiers_text || null
            }))
          };
          this.applyLocalSaleStockDeduction(this.cart);
          this.lastSale = offlineSale;
          this.lastSaleCustomer = this.selectedCustomer ? { ...this.selectedCustomer } : null;
          const giftCardPayment = (payments || []).find(p => (p.type || p.payment_type) === 'giftcard' && p.gift_card_code);
          this.lastSaleGiftCardCode = giftCardPayment?.gift_card_code || null;
          this.lastSaleGiftCardAmount = Number(giftCardPayment?.amount) || 0;
          this.cart = [];
          this.discount = 0;
          this.discountApprover = null;
          this.discountManagerPin = null;
          this.orderType = null;
          this.selectedTable = null;
          this.updateTableLabel?.();
          this.selectedCustomer = null;
          this.clearCustomer?.();
          this.loadedQuoteId = null;
          this.renderCart?.();
          this.renderProducts?.();
          Utils.toast(
            res.message || 'Sale saved offline — it will sync when internet returns (no duplicate).',
            'warning'
          );
          this.showOrderSuccess(
            offlineSale,
            change,
            payments,
            0,
            loyaltyRedeem || 0,
            loyaltyDiscount || 0,
            this.lastSaleCustomer
          );
          return;
        }
        if (!res.success) throw new Error(res.error || 'Sale failed');
        const sale = res.data?.sale || res.data;
        if (sale && !sale.receipt_number && res.data?.receiptNumber) {
          sale.receipt_number = res.data.receiptNumber;
        }
        const saleId = res.data?.saleId || sale?.id;
        const loyaltyPointsEarned = res.data?.loyaltyPointsEarned || 0;
        const loyaltyPointsRedeemed = res.data?.loyaltyPointsRedeemed || loyaltyRedeem || 0;
        const loyaltyDiscountApplied = res.data?.loyaltyDiscount != null ? res.data.loyaltyDiscount : (loyaltyDiscount || 0);
        const loyaltyBalanceAfter = res.data?.loyaltyBalanceAfter;
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
        // Carry meal flags from cart so success screen can offer Send Recipe
        const cartRecipeMap = new Map(
          (this.cart || []).map((i) => [String(i.product_id), !!(i.has_recipe || i.item_type === 'restaurant')])
        );
        if (Array.isArray(sale.items)) {
          sale.items = sale.items.map((it) => ({
            ...it,
            has_recipe: !!(it.has_recipe || cartRecipeMap.get(String(it.product_id)) || it.item_type === 'restaurant')
          }));
        } else if (this.cart?.length) {
          sale.items = this.cart.map((i) => ({
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total: i.total,
            has_recipe: !!(i.has_recipe || i.item_type === 'restaurant'),
            item_type: i.item_type || null
          }));
        }
        this.lastSale = sale;
        this.lastSaleCustomer = this.selectedCustomer ? { ...this.selectedCustomer } : null;
        if (this.lastSaleCustomer && loyaltyBalanceAfter != null) {
          this.lastSaleCustomer.loyalty_points = loyaltyBalanceAfter;
        } else if (this.lastSaleCustomer) {
          const startPts = Math.floor(this.lastSaleCustomer.loyalty_points || 0);
          this.lastSaleCustomer.loyalty_points = Math.max(0, startPts - (loyaltyPointsRedeemed || 0) + (loyaltyPointsEarned || 0));
        }
        const giftCardPayment = (payments || []).find(p => (p.type || p.payment_type) === 'giftcard' && p.gift_card_code);
        this.lastSaleGiftCardCode = giftCardPayment?.gift_card_code || null;
        this.lastSaleGiftCardAmount = Number(giftCardPayment?.amount) || 0;

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
        this.renderCart();
        this.renderProducts();
        this.showOrderSuccess(sale, change, payments, loyaltyPointsEarned, loyaltyPointsRedeemed, loyaltyDiscountApplied, this.lastSaleCustomer);
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
          try { this.renderTargetBanner?.(); this._prefetchTodayTarget?.(); } catch (_) { /* ignore */ }
        try {
          const tid = Number(saleData.table_id);
          if (tid && Array.isArray(this._tablesCache)) {
            this._tablesCache = this._tablesCache.map((t) =>
              Number(t.id) === tid ? { ...t, status: 'occupied', is_occupied: true } : t
            );
          }
        } catch (_) { /* ignore */ }
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
          try { await this.updateShiftBar(); } catch (_) { /* target banner */ }
        };
        postSaleWork();
        } catch (err) {
          Utils.toast(err?.message || 'Sale failed', 'error');
          throw err;
        } finally {
          releaseCheckout();
        }
      }
    });
  },

  resolveWhatsAppCustomer(sale, customer = null) {
    const cust = customer || this.lastSaleCustomer || {};
    const phone = String(cust.phone || sale?.customer_phone || '').trim();
    const name = cust.name || cust.full_name || sale?.customer_name || 'Customer';
    const id = cust.id || sale?.customer_id || null;
    return { phone, name, id, loyalty_points: cust.loyalty_points };
  },

  /** True when this sale is linked to a saved POS customer (picked from the system). */
  saleHasSystemCustomer(sale, recipient = null) {
    const id = recipient?.id || sale?.customer_id;
    return !!(id && Number(id) > 0);
  },

  async promptWhatsAppPhone(defaultName = 'Customer', opts = {}) {
    const needName = opts.needName !== false && !String(defaultName || '').trim();
    const title = needName ? 'Customer details for WhatsApp' : 'Customer WhatsApp number';
    const hint = needName
      ? 'This sale has no customer on file. Enter name and mobile number to send the receipt.'
      : 'Enter the customer\'s mobile number to send the receipt via WhatsApp.';
    return new Promise((resolve) => {
      Utils.showModal(title, `
        <p class="muted">${hint}</p>
        <div class="field"><label>Phone *</label><input id="wa-prompt-phone" type="tel" inputmode="tel" placeholder="071 234 5678" autofocus value="${Utils.escHtml?.(opts.defaultPhone || '') || ''}"></div>
        ${needName
          ? `<div class="field"><label>Name *</label><input id="wa-prompt-name" value="" placeholder="Customer name"></div>`
          : `<div class="field"><label>Name</label><input id="wa-prompt-name" value="${Utils.escHtml?.(defaultName) || defaultName}"></div>`}`,
        '<button class="btn btn-ghost" id="wa-prompt-cancel">Cancel</button><button class="btn btn-success" id="wa-prompt-send">Send WhatsApp</button>');
      document.getElementById('wa-prompt-cancel')?.addEventListener('click', () => {
        Utils.hideModal();
        resolve(null);
      });
      document.getElementById('wa-prompt-send')?.addEventListener('click', () => {
        const phone = document.getElementById('wa-prompt-phone')?.value.trim();
        const name = document.getElementById('wa-prompt-name')?.value.trim() || defaultName || 'Customer';
        if (!phone) return Utils.toast('Phone number required', 'error');
        if (needName && !name) return Utils.toast('Customer name required', 'error');
        Utils.hideModal();
        resolve({ phone, name });
      });
    });
  },

  async ensureWhatsAppRecipient(sale, baseRecipient = null) {
    let recipient = baseRecipient || this.resolveWhatsAppCustomer(sale);
    // Always prefer saved customer record when linked
    if ((!recipient.phone || !recipient.name || recipient.name === 'Customer') && sale?.customer_id) {
      try {
        const c = await API.getCustomer(sale.customer_id);
        const cust = c?.data || c;
        if (cust?.id) {
          recipient = {
            ...recipient,
            id: cust.id,
            phone: String(cust.phone || recipient.phone || '').trim(),
            name: cust.name || cust.full_name || recipient.name,
            loyalty_points: cust.loyalty_points ?? recipient.loyalty_points
          };
        }
      } catch (_) { /* ignore */ }
    }
    if (recipient.phone) return recipient;
    const prompted = await this.promptWhatsAppPhone(recipient.name || 'Customer', {
      needName: !this.saleHasSystemCustomer(sale, recipient)
        && (!recipient.name || recipient.name === 'Customer')
    });
    if (!prompted) return null;
    return { ...recipient, phone: prompted.phone, name: prompted.name || recipient.name };
  },

  _successStorageKey() {
    const uid = this.app?.user?.id || 'anon';
    return `shoppos_pos_success_${uid}`;
  },

  _persistSuccessState(payload) {
    this._successOpen = true;
    this._successPayload = payload;
    try {
      sessionStorage.setItem(this._successStorageKey(), JSON.stringify({ ...payload, at: Date.now() }));
    } catch (_) { /* ignore */ }
  },

  _clearSuccessState() {
    this._successOpen = false;
    this._successPayload = null;
    try { sessionStorage.removeItem(this._successStorageKey()); } catch (_) { /* ignore */ }
  },

  _loadSuccessState() {
    if (this._successPayload?.sale?.receipt_number) return this._successPayload;
    try {
      const raw = sessionStorage.getItem(this._successStorageKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.sale?.receipt_number) return null;
      if (Date.now() - (data.at || 0) > 8 * 60 * 60 * 1000) {
        this._clearSuccessState();
        return null;
      }
      this._successPayload = data;
      this._successOpen = true;
      return data;
    } catch (_) {
      return null;
    }
  },

  _restoreSuccessIfNeeded() {
    const data = this._loadSuccessState();
    if (!data) return false;
    this.lastSale = data.sale;
    this.lastSaleCustomer = data.customer || null;
    this.lastSaleGiftCardCode = data.giftCardCode || null;
    this.lastSaleGiftCardAmount = data.giftCardAmount || 0;
    this.showOrderSuccess(
      data.sale,
      data.change,
      data.payments,
      data.loyaltyEarned || 0,
      data.loyaltyRedeemed || 0,
      data.loyaltyDiscount || 0,
      data.customer || null
    );
    return true;
  },

  _bindSuccessResume() {
    if (this._successResumeBound) return;
    this._successResumeBound = true;
    const resume = () => {
      if (this.app?.currentPage && this.app.currentPage !== 'pos') return;
      if (this._loadSuccessState()) this._restoreSuccessIfNeeded();
    };
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resume();
    });
    try {
      window.Capacitor?.Plugins?.App?.addListener?.('appStateChange', (state) => {
        if (state?.isActive) resume();
      });
    } catch (_) { /* optional */ }
  },

  _shopIdentity() {
    const settings = this.app?.settings || {};
    const shop = String(settings.shop_name || 'our shop').trim();
    const branch = String(this.activeBranch?.name || '').trim();
    const orderUrl = (typeof Utils.getOnlineOrderUrl === 'function')
      ? Utils.getOnlineOrderUrl()
      : ((typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:'))
        ? `${location.origin.replace(/\/$/, '')}/order/`
        : '/order/');
    return { shop, branch, orderUrl };
  },

  _buildReceiptWhatsAppText(sale, recipient, extras = {}) {
    const settings = this.app?.settings || {};
    const currency = settings.currency || 'R';
    const { shop, branch, orderUrl } = this._shopIdentity();
    const receiptLines = Receipt.buildWhatsAppLines(sale, settings);
    const earned = Number(extras.loyaltyEarned || 0);
    const redeemed = Number(extras.loyaltyRedeemed || 0);
    const startPts = Math.floor(recipient.loyalty_points || 0);
    const balance = extras.loyaltyBalance != null
      ? Math.floor(extras.loyaltyBalance)
      : Math.max(0, startPts + earned - redeemed);
    const earnedWorth = Utils.loyaltyPointsValue(earned, settings, currency);
    const redeemedWorth = Utils.loyaltyPointsValue(redeemed, settings, currency);
    const balanceWorth = Utils.loyaltyPointsValue(balance, settings, currency);
    const giftLine = extras.giftLine || '';
    const delivery = sale.delivery_address || extras.deliveryAddress || '';
    return [
      `*${shop}*`,
      branch ? `Branch: ${branch}` : '',
      '',
      `Good day ${recipient.name || 'Customer'},`,
      '',
      `Thank you for shopping with ${shop}. Here is your receipt:`,
      '',
      `🧾 ${sale.order_number || sale.receipt_number}`,
      delivery ? `📍 Deliver to: ${delivery}` : '',
      receiptLines,
      '',
      `*Total: ${Utils.formatMoney(sale.total, currency)}*`,
      '',
      '*Loyalty points*',
      `⭐ Points earned: ${earned} pts (= ${earnedWorth.formatted})`,
      `⭐ Points used: ${redeemed} pts (= ${redeemedWorth.formatted})`,
      `⭐ Points balance: ${balance} pts (= ${balanceWorth.formatted})`,
      giftLine,
      '',
      'Order online anytime:',
      orderUrl,
      '',
      `Thank you for shopping with ${shop}.`
    ].filter((line, i, arr) => line !== '' || arr[i - 1] !== '').join('\n').trim();
  },

  _buildReviewWhatsAppText(sale, recipient) {
    const { shop, branch, orderUrl } = this._shopIdentity();
    const currency = this.app?.settings?.currency || 'R';
    const name = recipient.name || 'Valued Customer';
    const orderNo = sale.order_number || sale.receipt_number || '';
    const total = Utils.formatMoney(sale.total, currency);
    const shopLine = branch ? `${shop} — ${branch}` : shop;
    const visitLine = orderNo
      ? `We hope you enjoyed your recent visit (Order ${orderNo}, ${total}).`
      : `We hope you enjoyed your recent visit (${total}).`;
    return [
      `Good day ${name},`,
      '',
      `Thank you for choosing ${shopLine}.`,
      '',
      visitLine,
      '',
      'Your feedback is important to us. If you have a moment, we would greatly appreciate a short review of your experience with us.',
      '',
      'You are welcome to place your next order online at any time:',
      orderUrl,
      '',
      'Thank you again for your support.',
      '',
      'Kind regards,',
      shop
    ].join('\n');
  },

  async refreshWhatsAppMode() {
    try {
      const r = await API.getWhatsAppSettings();
      const data = r?.data || r || {};
      if (!this.app.settings) this.app.settings = {};
      const prev = this.app.settings.whatsapp_settings || {};
      this.app.settings.whatsapp_settings = {
        ...prev,
        ...data,
        use_cloud_api: data.use_cloud_api !== false
      };
      if (window.App?.settings) window.App.settings.whatsapp_settings = this.app.settings.whatsapp_settings;
    } catch (_) { /* keep cached */ }
  },

  async _openOrSendWhatsApp({ phone, body, payload, btn, busyLabel, doneLabel }) {
    try { window.PanelExitGuard?.suspend?.(45000); } catch (_) { /* ignore */ }
    if (this._successPayload?.sale) this._persistSuccessState(this._successPayload);
    if (btn) {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = busyLabel || 'Opening WhatsApp…';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = doneLabel || prev;
      }, 1200);
    }

    // Always re-read Admin toggle so POS does not keep a stale “API on” setting
    await this.refreshWhatsAppMode();
    const manual = Utils.preferManualWhatsApp(this.app?.settings) || !Utils.canSilentWhatsApp(this.app?.settings);
    const url = Utils.whatsappUrl(phone, body);

    // Regular mode: open WhatsApp immediately on the user tap (do not wait for API)
    if (manual && url) {
      Utils.openWhatsAppUrl(url);
      Utils.toast('WhatsApp opened — tap Send, then come back here', 'success');
    }

    const sendPayload = {
      ...payload,
      phone,
      body,
      force_wa_me: !!manual,
      prefer_wa_me: !!manual
    };

    try {
      const r = await API.sendWhatsAppMessage(sendPayload, this.app.user);
      const data = r?.data || r || {};
      const via = data.via || '';
      const openUrl = data.url || url;

      if (!manual) {
        // API mode
        if (via === 'cloud_api' && !openUrl) {
          Utils.toast('Sent via WhatsApp API', 'success');
        } else if (openUrl) {
          Utils.openWhatsAppUrl(openUrl);
          Utils.toast('WhatsApp opened — tap Send, then come back here', 'success');
        } else {
          Utils.toast(r?.error || data.cloud_error || 'WhatsApp failed', 'error');
        }
      } else if (openUrl && via === 'wa.me') {
        // Ensure chat opened even if the first open was blocked
        Utils.openWhatsAppUrl(openUrl);
      }
      return r;
    } catch (err) {
      if (url) {
        Utils.openWhatsAppUrl(url);
        Utils.toast('WhatsApp opened — tap Send, then come back here', 'success');
      } else {
        Utils.toast(err?.message || 'WhatsApp failed', 'error');
      }
      return null;
    }
  },

  resetPosSaleUi(opts = {}) {
    if (opts.dismissSuccess) this._clearSuccessState();
    if (!opts.dismissSuccess && this._loadSuccessState()) {
      this._restoreSuccessIfNeeded();
      return;
    }
    document.getElementById('pos-success-screen')?.classList.add('hidden');
    const till = this._host?.querySelector?.('.pos-till') || document.querySelector('.pos-till');
    till?.classList.remove('hidden');
    document.querySelector('.pos-layout')?.classList.remove('hidden');
    document.getElementById('pos-mobile-dock')?.classList.remove('hidden');
  },

  showOrderSuccess(sale, change, payments, loyaltyPointsEarned = 0, loyaltyPointsRedeemed = 0, loyaltyDiscount = 0, customer = null) {
    const currency = this.app.settings?.currency || 'R';
    const labels = PaymentUI.labels(this.app.settings);
    const till = document.querySelector('.pos-till');
    till?.classList.add('hidden');
    document.querySelector('.pos-layout')?.classList.add('hidden');
    const screen = document.getElementById('pos-success-screen');
    if (!screen) return;
    screen.classList.remove('hidden');

    const q = (sel) => screen.querySelector(sel);
    const receiptEl = q('#pos-success-receipt');
    const totalEl = q('#pos-success-total');
    const changeEl = q('#pos-success-change');
    const loyaltyEl = q('#pos-success-loyalty');
    const paymentsEl = q('#pos-success-payments');
    const waBtn = q('#pos-success-wa');
    const reviewBtn = q('#pos-success-review');
    const recipeBtn = q('#pos-success-recipe');
    const printBtn = q('#pos-success-print');
    const newBtn = q('#pos-success-new');

    if (receiptEl) receiptEl.textContent = `${sale?.order_number || sale?.receipt_number || '—'}`;
    if (totalEl) totalEl.textContent = Utils.formatMoney(sale?.total, currency);
    if (changeEl) {
      changeEl.textContent = change > 0
        ? `Change: ${Utils.formatMoney(change, currency)}` : '';
    }
    if (loyaltyEl) {
      const parts = [];
      const cust = customer || this.lastSaleCustomer;
      const balance = Math.max(0, Math.floor(Number(cust?.loyalty_points) || 0));
      const balanceWorth = Utils.loyaltyPointsValue(balance, this.app.settings, currency);
      if (loyaltyPointsRedeemed > 0) {
        parts.push(`Redeemed ${loyaltyPointsRedeemed} pts (−${Utils.formatMoney(loyaltyDiscount, currency)})`);
      }
      if (loyaltyPointsEarned > 0) {
        const earnedWorth = Utils.loyaltyPointsValue(loyaltyPointsEarned, this.app.settings, currency);
        parts.push(`Earned ${loyaltyPointsEarned} pts (= ${earnedWorth.formatted})`);
      }
      if (cust) {
        parts.push(`Balance now ${balance} pts (= ${balanceWorth.formatted})`);
      }
      if (this.lastSaleGiftCardCode) {
        parts.push(`Gift card ${this.lastSaleGiftCardCode}: −${Utils.formatMoney(this.lastSaleGiftCardAmount || 0, currency)}`);
      }
      loyaltyEl.textContent = parts.length ? `⭐ ${parts.join(' · ')}` : '';
    }
    if (paymentsEl) {
      paymentsEl.innerHTML = (payments || sale?.payments || []).map(p => {
        const type = p.type || p.payment_type;
        const code = p.gift_card_code ? ` · code ${p.gift_card_code}` : '';
        return `${labels[type] || type}${code}: ${Utils.formatMoney(p.amount, currency)}`;
      }).join(' · ');
    }

    const waRecipient = this.resolveWhatsAppCustomer(sale, customer);
    reviewBtn?.classList.remove('hidden');

    const giftLine = this.lastSaleGiftCardCode
      ? `🎁 Gift card ${this.lastSaleGiftCardCode}: −${Utils.formatMoney(this.lastSaleGiftCardAmount || 0, currency)}`
      : '';
    this._persistSuccessState({
      sale,
      change,
      payments: payments || sale?.payments || [],
      loyaltyEarned: loyaltyPointsEarned,
      loyaltyRedeemed: loyaltyPointsRedeemed,
      loyaltyDiscount,
      customer: customer || this.lastSaleCustomer || null,
      giftCardCode: this.lastSaleGiftCardCode || null,
      giftCardAmount: this.lastSaleGiftCardAmount || 0
    });

    const recipeItems = (sale?.items || []).filter((i) =>
      i && (i.has_recipe || i.item_type === 'restaurant') && i.product_id
    );
    if (recipeBtn) {
      recipeBtn.classList.toggle('hidden', !recipeItems.length);
      recipeBtn.onclick = null;
    }

    const sendReceiptWhatsApp = async () => {
      const recipient = await this.ensureWhatsAppRecipient(sale, { ...waRecipient });
      if (!recipient?.phone) return;
      reviewBtn?.classList.remove('hidden');
      const receiptLines = Receipt.buildWhatsAppLines(sale, this.app.settings);
      const body = this._buildReceiptWhatsAppText(sale, recipient, {
        loyaltyEarned: loyaltyPointsEarned,
        loyaltyRedeemed: loyaltyPointsRedeemed,
        loyaltyBalance: Math.floor(Number(recipient.loyalty_points) || 0),
        giftLine,
        deliveryAddress: sale.delivery_address || this.deliveryAddress || ''
      });
      const earnedWorth = Utils.loyaltyPointsValue(loyaltyPointsEarned, this.app.settings, currency);
      const balance = Math.floor(Number(recipient.loyalty_points) || 0);
      const balanceWorth = Utils.loyaltyPointsValue(balance, this.app.settings, currency);
      const deliveryAddr = sale.delivery_address || this.deliveryAddress || '';
      this._openOrSendWhatsApp({
        phone: recipient.phone,
        body,
        btn: waBtn,
        busyLabel: 'Opening WhatsApp…',
        doneLabel: '💬 Send Receipt on WhatsApp',
        payload: {
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
        }
      });
      Receipt.downloadPdf(sale, this.app.settings).catch(() => {});
    };

    if (waBtn) waBtn.onclick = () => sendReceiptWhatsApp();
    reviewBtn?.classList.remove('hidden');
    if (reviewBtn) {
      reviewBtn.onclick = async () => {
        const recipient = await this.ensureWhatsAppRecipient(sale, { ...waRecipient });
        if (!recipient?.phone) return;
        reviewBtn?.classList.remove('hidden');
        const { orderUrl } = this._shopIdentity();
        const body = this._buildReviewWhatsAppText(sale, recipient);
        this._openOrSendWhatsApp({
          phone: recipient.phone,
          body,
          btn: reviewBtn,
          busyLabel: 'Opening WhatsApp…',
          doneLabel: '⭐ Request Review',
          payload: {
            customer_id: recipient.id,
            recipient_type: 'customer',
            recipient_name: recipient.name,
            customer_name: recipient.name,
            branch: this.activeBranch?.name || this.app.settings?.shop_name,
            phone_shop: this.app.settings?.phone,
            order_number: sale.order_number || sale.receipt_number,
            receipt_number: sale.receipt_number,
            total_purchase: sale.total,
            sale_id: sale.id,
            order_url: orderUrl,
            online_order_url: orderUrl,
            message_type: 'review_request',
            template_slug: 'review_request'
          }
        });
      };
    }

    if (recipeBtn && recipeItems.length) {
      recipeBtn.onclick = async () => {
        const recipient = await this.ensureWhatsAppRecipient(sale, { ...waRecipient });
        if (!recipient?.phone) return;
        const body = await this._buildMealRecipeWhatsAppText(sale, recipeItems);
        if (!body) {
          Utils.toast('No recipe details found for these meals', 'warning');
          return;
        }
        this._openOrSendWhatsApp({
          phone: recipient.phone,
          body,
          btn: recipeBtn,
          busyLabel: 'Opening WhatsApp…',
          doneLabel: '📖 Send Recipe on WhatsApp',
          payload: {
            customer_id: recipient.id,
            recipient_type: 'customer',
            recipient_name: recipient.name,
            customer_name: recipient.name,
            branch: this.activeBranch?.name || this.app.settings?.shop_name,
            phone_shop: this.app.settings?.phone,
            order_number: sale.order_number || sale.receipt_number,
            receipt_number: sale.receipt_number,
            sale_id: sale.id,
            message_type: 'meal_recipe',
            template_slug: 'custom',
            custom_message: body
          }
        });
      };
    }

    if (printBtn) {
      printBtn.onclick = async () => {
        try {
          await Receipt.print(sale, this.app.settings);
          Utils.toast('Receipt sent to printer', 'success');
        } catch (err) {
          Utils.toast(err.message || 'Print failed', 'error');
        }
      };
    }
    if (newBtn) {
      newBtn.onclick = () => {
        this.resetPosSaleUi({ dismissSuccess: true });
        this.setMobilePanel('menu');
        document.getElementById('pos-search')?.focus();
      };
    }
  },

  async _buildMealRecipeWhatsAppText(sale, recipeItems) {
    const shop = this.app.settings?.shop_name || 'Us';
    const blocks = [];
    const seen = new Set();
    for (const item of recipeItems || []) {
      const pid = Number(item.product_id);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      try {
        const res = await API.recipeGetMeal(pid, this.app.user, { for_editor: true, for_share: true });
        const data = res?.data != null ? res.data : res;
        if (!data || res?.success === false) continue;
        const product = data.product || {};
        const profile = data.recipe_profile || {};
        const name = profile.name || product.name || item.product_name || 'Meal';
        const instructions = String(profile.instructions || '').trim();
        const allergens = String(profile.allergens || product.allergens || '').trim();
        const notes = String(profile.notes || '').trim();
        if (!instructions && !allergens && !notes) continue;
        const lines = [`🍽️ *${name}*`];
        if (instructions) lines.push('', instructions);
        if (allergens) lines.push('', `⚠️ Allergens: ${allergens}`);
        if (notes) lines.push('', `📝 Kitchen notes: ${notes}`);
        blocks.push(lines.join('\n'));
      } catch (_) { /* skip meals without shareable recipe */ }
    }
    if (!blocks.length) return '';
    const receipt = sale?.receipt_number ? ` (Receipt #${sale.receipt_number})` : '';
    return `📖 *Recipe from ${shop}*${receipt}\n\n${blocks.join('\n\n—\n\n')}\n\nEnjoy! 🙏`;
  },

  handleCustomerRewardNotifications(reward, currency) {
    const grants = reward.grants || [];
    if (!grants.length) return;
    const first = grants[0];
    const code = first.gift_card?.code;
    const amount = first.gift_card?.balance;
    Utils.toast(`🎁 Auto gift card created: ${code} (${Utils.formatMoney(amount, currency)})`, 'success');
    const onPhone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches;
    if (first.customer_whatsapp_url && !onPhone) {
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
  },

  startAdvertReminderMonitor() {
    this.stopAdvertReminderMonitor();
    this._advertInterval = setInterval(() => this.checkAdvertReminders(), 30000);
    this.checkAdvertReminders();
  },

  stopAdvertReminderMonitor() {
    if (this._advertInterval) clearInterval(this._advertInterval);
    this._advertInterval = null;
  },

  _normAdvertTime(t) {
    const s = String(t || '').trim().slice(0, 5);
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    return `${String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0')}:${m[2]}`;
  },

  _advertTimeMatches(nowHHMM, targetHHMM) {
    const parse = (v) => {
      const [h, m] = String(v).split(':').map(Number);
      return (h * 60) + m;
    };
    return Math.abs(parse(nowHHMM) - parse(targetHHMM)) <= 1;
  },

  _getAdvertFiredToday() {
    try {
      const raw = JSON.parse(localStorage.getItem('shoppos_advert_fired') || '{}');
      if (raw.date !== Utils.today()) return [];
      return raw.times || [];
    } catch (_) {
      return [];
    }
  },

  _markAdvertFired(time) {
    const today = Utils.today();
    const times = this._getAdvertFiredToday();
    if (!times.includes(time)) times.push(time);
    localStorage.setItem('shoppos_advert_fired', JSON.stringify({ date: today, times }));
  },

  async checkAdvertReminders() {
    const cfg = this.app?.settings?.notification_settings?.pos_advert_reminders;
    if (!cfg?.enabled) return;
    const times = (cfg.times || []).map((t) => this._normAdvertTime(t)).filter(Boolean);
    if (!times.length) return;
    const now = new Date();
    const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const fired = this._getAdvertFiredToday();
    for (const t of times) {
      if (fired.includes(t)) continue;
      if (!this._advertTimeMatches(current, t)) continue;
      this._markAdvertFired(t);
      await this.showAdvertReminderModal(cfg);
      break;
    }
  },

  async showAdvertReminderModal(cfg) {
    if (this._advertModalOpen) return;
    this._advertModalOpen = true;
    const msg = cfg.message || 'Time to advertise on WhatsApp!';
    if (cfg.sound_enabled !== false) {
      if (window.PanelSound) {
        PanelSound.setPanel('pos');
        PanelSound.setEnabled(true);
        await PanelSound.playOnce();
      } else if (window.SoundService) {
        await SoundService.playOnce(this.app?.settings);
      }
    }
    Utils.showModal('Advertise on WhatsApp', `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:42px;margin-bottom:12px">📣</div>
        <p style="margin:0;font-size:17px;line-height:1.5;font-weight:600">${Utils.escHtml(msg)}</p>
      </div>`,
    '<button type="button" class="btn btn-primary btn-lg" id="pos-advert-dismiss" style="min-width:200px">OK, I will advertise</button>');
    document.getElementById('pos-advert-dismiss')?.addEventListener('click', () => {
      Utils.hideModal();
      this._advertModalOpen = false;
      window.PanelSound?.stop?.();
    });
  }
};
window.POSPage = POSPage;
