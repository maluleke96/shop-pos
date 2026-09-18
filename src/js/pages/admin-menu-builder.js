/**
 * Admin — Menu Builder
 * Select products → choose size/orientation/colour → auto-generate professional menus.
 * Uses existing products, branch/shop settings, and PromoPoster branding colours.
 */
window.AdminMenuBuilderPage = {
  el: null,
  app: null,
  mode: 'home', // home | builder | preview
  products: [],
  branches: [],
  settings: {},
  selectedIds: new Set(),
  searchQ: '',
  branchId: 'all',
  generatedPages: [], // { canvas, dataUrl }
  draft: {
    menuType: 'full',
    pageSize: 'A4',
    orientation: 'portrait',
    theme: 'red',
    includeLogo: true,
    includeBranch: true,
    includePhone: true,
    includeDate: true,
    includeFooter: true,
    customTitle: 'Our Menu',
    footerText: ''
  },

  THEMES: {
    // Match PromoPoster / Combos branding (red default)
    red: { accent: '#ef4444', accentDark: '#dc2626', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    yellow: { accent: '#eab308', accentDark: '#ca8a04', gold: '#fde047', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    green: { accent: '#22c55e', accentDark: '#16a34a', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    blue: { accent: '#3b82f6', accentDark: '#2563eb', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    darkblue: { accent: '#1e3a8a', accentDark: '#1e293b', gold: '#fbbf24', bg: '#020617', card: '#0f172a', text: '#f8fafc', muted: '#94a3b8' },
    purple: { accent: '#a855f7', accentDark: '#7c3aed', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' }
  },

  /** Printable mm sizes (portrait). Landscape swaps. */
  SIZES: {
    A1: { w: 594, h: 841, label: 'A1' },
    A2: { w: 420, h: 594, label: 'A2' },
    A3: { w: 297, h: 420, label: 'A3' },
    A4: { w: 210, h: 297, label: 'A4' },
    A5: { w: 148, h: 210, label: 'A5' },
    flyer: { w: 100, h: 210, label: 'Flyer' },
    square: { w: 210, h: 210, label: 'Square / Social' },
    social: { w: 108, h: 192, label: 'Social Story' }
  },

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  money(n) {
    const c = this.settings?.currency || this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney) ? Utils.formatMoney(Number(n) || 0, c) : `${c}${(Number(n) || 0).toFixed(2)}`;
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },

  ensureCss() {
    const href = `css/menu-builder.css?v=2`;
    let l = document.getElementById('menu-builder-css');
    if (l) {
      if (!String(l.getAttribute('href') || '').includes('v=2')) l.href = href;
      return;
    }
    l = document.createElement('link');
    l.id = 'menu-builder-css';
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  },

  async render(el, adminPage) {
    this.el = el;
    this.app = adminPage?.app || adminPage || (typeof App !== 'undefined' ? App : null);
    this.ensureCss();
    // Open straight into the builder (matches mockup) — never block on network
    this.mode = 'builder';
    this.productsLoading = !!this.productsLoading;
    this.settings = this.settings?.shop_name ? this.settings : (this.app?.settings || {});
    if (!this.draft.footerText) {
      this.draft.footerText = this.settings.receipt_footer
        || this.settings.slogan
        || 'Good Food • Great People • Always Connected.';
    }
    this.paintBuilder();
    this.bootstrapData();
  },

  bootstrapData() {
    this.loadMeta().then(() => {
      if (this.mode === 'builder' && this.el) this.updateBranchSelect();
    }).catch(() => {});
    if (!this.products.length) this.productsLoading = true;
    this.loadProducts().then(() => {
      this.productsLoading = false;
      if (this.mode === 'builder') this.refreshProductList();
    }).catch(() => {
      this.productsLoading = false;
      if (this.mode === 'builder') this.refreshProductList();
    });
    if (!this.waSettings) {
      API.getWhatsAppSettings?.().then((wa) => {
        this.waSettings = wa?.data || wa || {};
      }).catch(() => { this.waSettings = {}; });
    }
  },

  async loadMeta() {
    const [br, st] = await Promise.all([
      API.getBranches?.().catch(() => null),
      API.getSettingsParsed?.().catch(() => null)
    ]);
    let branches = br?.success !== false ? (br?.data ?? br ?? []) : [];
    if (!Array.isArray(branches)) branches = [];
    this.branches = branches;
    this.settings = st?.data || st || this.app?.settings || this.settings || {};
    if (!this.draft.footerText) {
      this.draft.footerText = this.settings.receipt_footer
        || this.settings.slogan
        || 'Good Food • Great People • Always Connected.';
    }
    const userBranch = this.app?.user?.branch_id;
    if ((!this.branchId || this.branchId === 'all') && userBranch
      && this.branches.some((b) => Number(b.id) === Number(userBranch))) {
      this.branchId = String(userBranch);
    } else if ((!this.branchId || this.branchId === 'all') && this.branches.length === 1) {
      this.branchId = String(this.branches[0].id);
    }
  },

  normalizeProductList(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList
      .filter((p) => p && p.id != null
        && (p.is_active === undefined || p.is_active === 1 || p.is_active === true
          || p.is_active === '1' || p.is_active === 't')
        && String(p.item_type || '') !== 'ingredient')
      .map((p) => ({
        id: Number(p.id),
        name: p.name || `#${p.id}`,
        selling_price: Number(p.selling_price) || 0,
        sku: p.sku || '',
        barcode: p.barcode || '',
        description: p.description || p.category_name || '',
        picture_path: p.picture_path,
        has_picture: p.has_picture || p._hasImage,
        category_name: p.category_name || ''
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  },

  async loadProducts() {
    if (this._productsPromise) return this._productsPromise;
    this.productsLoading = true;
    this._productsPromise = (async () => {
      try {
        const get = API.getProducts?._uncached || API.getProducts;
        if (typeof get !== 'function') return [];
        const attempts = [
          { admin_list: true, omit_images: true, all_branches: true },
          { admin_list: true, all_branches: true },
          { admin_list: true, omit_images: true },
          { admin_list: true },
          { combo_picker: true },
          { omit_images: true, all_branches: true },
          {}
        ];
        for (const filters of attempts) {
          try {
            const pr = await get(filters);
            if (!pr || pr.success === false) continue;
            const list = this.normalizeProductList(pr.data ?? pr);
            if (list.length) {
              this.products = list;
              return list;
            }
          } catch (_) { /* next */ }
        }
        try {
          const search = await API.globalSearch?.('a');
          const hits = search?.data?.products || search?.products || [];
          const list = this.normalizeProductList(hits);
          if (list.length) {
            this.products = list;
            return list;
          }
        } catch (_) { /* ignore */ }
        this.products = this.products || [];
        return this.products;
      } finally {
        this.productsLoading = false;
        this._productsPromise = null;
      }
    })();
    return this._productsPromise;
  },

  selectedBranch() {
    if (this.branchId === 'all' || !this.branchId) return null;
    return this.branches.find((b) => String(b.id) === String(this.branchId)) || null;
  },

  shopBlock() {
    const b = this.selectedBranch();
    const s = this.settings || {};
    return {
      shopName: s.shop_name || s.app_display_name || 'Shop',
      branchName: b?.name || (this.branchId === 'all' ? 'All branches' : ''),
      address: (b?.address && String(b.address).trim()) || s.address || '',
      phone: (b?.phone && String(b.phone).trim()) || s.phone || '',
      hours: b?.opening_hours || b?.hours || s.operating_hours_text || '7 AM – 9 PM',
      logoUrl: '/api/logo',
      currency: s.currency || 'R',
      date: (typeof Utils !== 'undefined' && Utils.today) ? Utils.today() : new Date().toLocaleDateString('en-CA')
    };
  },

  productImageUrl(p) {
    if (typeof Utils !== 'undefined' && Utils.productImageUrl) return Utils.productImageUrl(p);
    return p?.id ? `/api/product-image/${p.id}` : '';
  },

  paint() {
    return this.paintBuilder();
  },

  selectedProducts() {
    return this.products.filter((p) => this.selectedIds.has(Number(p.id)));
  },

  filteredProducts(q) {
    const query = String(q != null ? q : this.searchQ || '').trim().toLowerCase();
    if (!query) return this.products;
    return this.products.filter((p) => {
      const name = String(p.name || '').toLowerCase();
      const sku = String(p.sku || '').toLowerCase();
      const barcode = String(p.barcode || '').toLowerCase();
      return name.includes(query) || sku.includes(query) || barcode.includes(query);
    });
  },

  stepState() {
    if (this.generatedPages.length) return 4;
    if (this.selectedIds.size) return 2;
    return 1;
  },

  stepsHtml() {
    const step = this.stepState();
    const labels = ['Select Products', 'Choose Design', 'Generate', 'Download & Share'];
    return `<div class="mb-steps">${labels.map((label, i) => {
      const n = i + 1;
      const cls = n === step ? 'active' : (n < step ? 'done' : '');
      const sep = i < labels.length - 1 ? '<span class="mb-step-sep"></span>' : '';
      return `<span class="mb-step ${cls}"><span class="mb-step-num">${n < step ? '✓' : n}</span>${label}</span>${sep}`;
    }).join('')}</div>`;
  },

  productRowsHtml() {
    if (this.productsLoading && !this.products.length) {
      return `<div class="mb-skel"></div><div class="mb-skel"></div><div class="mb-skel"></div>
        <p class="mb-loading-inline">Loading products…</p>`;
    }
    const list = this.filteredProducts(this.searchQ);
    if (!list.length) {
      return `<p class="mb-empty">${this.products.length
        ? 'No products match your search.'
        : 'No products found. Add products in Products, then click Refresh.'}</p>`;
    }
    return list.slice(0, 400).map((p) => {
      const id = Number(p.id);
      const on = this.selectedIds.has(id);
      const img = this.productImageUrl(p);
      return `<label class="mb-prod-row ${on ? 'is-on' : ''}">
        <input type="checkbox" data-pid="${id}" ${on ? 'checked' : ''}>
        <span class="mb-thumb">${img ? `<img src="${this.esc(img)}" alt="" loading="lazy" onerror="this.parentNode.textContent='•'">` : '•'}</span>
        <span class="mb-prod-meta">
          <strong>${this.esc(p.name)}</strong>
          <small>${this.money(p.selling_price)}</small>
        </span>
      </label>`;
    }).join('');
  },

  paintBuilder() {
    const shop = this.shopBlock();
    const theme = this.THEMES[this.draft.theme] || this.THEMES.red;
    const userName = this.app?.user?.full_name || this.app?.user?.username || 'Admin';

    this.el.innerHTML = `<div class="mb-root mb-builder" style="--mb-accent:${theme.accent}">
      <div class="mb-header-row">
        <div>
          <h2>Menu Builder</h2>
          <p class="mb-sub">Create professional menus in seconds.</p>
        </div>
        <div class="mb-header-right">
          <span class="mb-branch-label">Branch</span>
          <select id="mb-branch" class="mb-select" title="Branch">
            <option value="all">All / shop default</option>
            ${this.branches.map((b) => `<option value="${b.id}" ${String(this.branchId) === String(b.id) ? 'selected' : ''}>${this.esc(b.name)}</option>`).join('')}
          </select>
          <span class="mb-branch-label">${this.esc(userName)}</span>
        </div>
      </div>
      ${this.stepsHtml()}
      <div class="mb-workspace">
        <section class="mb-col mb-col-products">
          <h3>Select Products</h3>
          <div class="mb-search-wrap">
            <input type="search" id="mb-search" class="mb-search"
              placeholder="${this.products.length ? `Search products (${this.products.length})…` : 'Search products…'}"
              value="${this.esc(this.searchQ)}" autocomplete="off">
            <div id="mb-search-results" class="mb-search-dropdown hidden" role="listbox"></div>
          </div>
          <div class="mb-prod-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="mb-select-visible">Select visible</button>
            <button type="button" class="btn btn-ghost btn-sm" id="mb-clear">Clear</button>
            <button type="button" class="btn btn-ghost btn-sm" id="mb-reload-prods">Refresh</button>
            <span class="muted" id="mb-sel-count">${this.selectedIds.size} selected</span>
          </div>
          <div class="mb-prod-list" id="mb-prod-list">${this.productRowsHtml()}</div>
        </section>

        <section class="mb-col mb-col-settings">
          <h3>Menu Settings</h3>
          <div class="field"><label>Menu Type</label>
            <select id="mb-type">
              <option value="full" ${this.draft.menuType === 'full' ? 'selected' : ''}>Full Menu</option>
              <option value="specials" ${this.draft.menuType === 'specials' ? 'selected' : ''}>Specials</option>
              <option value="takeaway" ${this.draft.menuType === 'takeaway' ? 'selected' : ''}>Takeaway</option>
            </select>
          </div>
          <div class="field"><label>Page Size</label>
            <select id="mb-size">
              ${Object.entries(this.SIZES).map(([k, v]) =>
                `<option value="${k}" ${this.draft.pageSize === k ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Orientation</label>
            <div class="mb-radio-row">
              <label><input type="radio" name="mb-ori" value="portrait" ${this.draft.orientation === 'portrait' ? 'checked' : ''}> Portrait</label>
              <label><input type="radio" name="mb-ori" value="landscape" ${this.draft.orientation === 'landscape' ? 'checked' : ''}> Landscape</label>
            </div>
          </div>
          <div class="field"><label>Theme / Colour</label>
            <div class="mb-swatches" id="mb-swatches">
              ${Object.keys(this.THEMES).map((k) =>
                `<button type="button" class="mb-swatch ${this.draft.theme === k ? 'active' : ''}" data-theme="${k}" style="background:${this.THEMES[k].accent}" title="${k}"></button>`
              ).join('')}
            </div>
          </div>
          <div class="field"><label>Include</label>
            <label class="mb-check"><input type="checkbox" id="mb-inc-logo" ${this.draft.includeLogo ? 'checked' : ''}> Shop Logo</label>
            <label class="mb-check"><input type="checkbox" id="mb-inc-branch" ${this.draft.includeBranch ? 'checked' : ''}> Branch Details</label>
            <label class="mb-check"><input type="checkbox" id="mb-inc-phone" ${this.draft.includePhone ? 'checked' : ''}> Contact Number</label>
            <label class="mb-check"><input type="checkbox" id="mb-inc-date" ${this.draft.includeDate ? 'checked' : ''}> Date</label>
            <label class="mb-check"><input type="checkbox" id="mb-inc-footer" ${this.draft.includeFooter ? 'checked' : ''}> Footer (Slogan / Social Media)</label>
          </div>
          <div class="field"><label>Custom Title</label>
            <input type="text" id="mb-title" value="${this.esc(this.draft.customTitle)}">
          </div>
          <div class="field"><label>Footer Text</label>
            <input type="text" id="mb-footer" value="${this.esc(this.draft.footerText)}">
          </div>
          <button type="button" class="btn btn-primary mb-generate" id="mb-generate" style="background:${theme.accent}">
            Generate Menu
          </button>
          <p class="mb-shop-hint">${this.esc(shop.shopName)}${shop.branchName ? ` · ${this.esc(shop.branchName)}` : ''}</p>
        </section>

        <section class="mb-col mb-col-preview">
          <h3>Preview</h3>
          <div class="mb-preview-stage" id="mb-preview-stage">
            ${this.generatedPages.length
              ? this.generatedPages.map((pg, i) =>
                `<div class="mb-preview-page"><img src="${pg.dataUrl}" alt="Menu page ${i + 1}"><span class="mb-page-tag">Page ${i + 1}</span></div>`
              ).join('')
              : `<div class="mb-preview-empty">
                  <p>Select products and click <strong>Generate Menu</strong></p>
                  <p>Layout adjusts automatically to size and product count.</p>
                </div>`}
          </div>
        </section>
      </div>
      ${this.actionBarHtml()}
    </div>`;
    this.bindBuilder();
  },

  updateBranchSelect() {
    const sel = document.getElementById('mb-branch');
    if (!sel || !this.branches.length) return;
    const cur = this.branchId;
    sel.innerHTML = `<option value="all">All / shop default</option>${this.branches.map((b) =>
      `<option value="${b.id}" ${String(cur) === String(b.id) ? 'selected' : ''}>${this.esc(b.name)}</option>`
    ).join('')}`;
  },

  refreshProductList() {
    const list = document.getElementById('mb-prod-list');
    if (list) list.innerHTML = this.productRowsHtml();
    const count = document.getElementById('mb-sel-count');
    if (count) count.textContent = `${this.selectedIds.size} selected`;
    const search = document.getElementById('mb-search');
    if (search && this.products.length) {
      search.placeholder = `Search products (${this.products.length})…`;
    }
    this.bindProductChecks();
    // Refresh step pills without full rebuild
    const steps = this.el?.querySelector('.mb-steps');
    if (steps) {
      const wrap = document.createElement('div');
      wrap.innerHTML = this.stepsHtml();
      steps.replaceWith(wrap.firstElementChild);
    }
  },

  paintSearchResults(q) {
    const resultsEl = document.getElementById('mb-search-results');
    if (!resultsEl) return;
    const query = String(q || '').trim();
    if (!query) {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      return;
    }
    const list = this.filteredProducts(query).slice(0, 40);
    if (!list.length) {
      resultsEl.innerHTML = '<div class="mb-search-empty">No matching products</div>';
      resultsEl.classList.remove('hidden');
      return;
    }
    resultsEl.innerHTML = list.map((p) => {
      const id = Number(p.id);
      const marked = this.selectedIds.has(id);
      return `<button type="button" class="mb-search-item ${marked ? 'marked' : ''}" data-pid="${id}">
        <span class="mb-search-check">${marked ? '✓' : '+'}</span>
        <span class="mb-search-name">${this.esc(p.name)}</span>
        <span class="mb-search-price">${this.money(p.selling_price)}</span>
      </button>`;
    }).join('');
    resultsEl.classList.remove('hidden');
    resultsEl.querySelectorAll('.mb-search-item').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const id = Number(btn.dataset.pid);
        if (this.selectedIds.has(id)) this.selectedIds.delete(id);
        else this.selectedIds.add(id);
        this.refreshProductList();
        this.paintSearchResults(document.getElementById('mb-search')?.value || '');
      });
    });
  },

  actionBarHtml() {
    const ready = this.generatedPages.length > 0;
    return `<div class="mb-action-bar">
      <button type="button" class="btn btn-ghost" id="mb-fullscreen" ${ready ? '' : 'disabled'}>View Full Screen</button>
      <button type="button" class="btn btn-primary" id="mb-pdf" ${ready ? '' : 'disabled'}>Save as PDF</button>
      <button type="button" class="btn btn-ghost" id="mb-print" ${ready ? '' : 'disabled'}>Print</button>
      <button type="button" class="btn mb-btn-wa" id="mb-wa" ${ready ? '' : 'disabled'}>Share to WhatsApp</button>
      <button type="button" class="btn mb-btn-group" id="mb-wa-group" ${ready ? '' : 'disabled'}>Share to Group</button>
      <span class="mb-action-hint">Menu will automatically adjust layout based on selected size and products.</span>
    </div>`;
  },

  readDraftFromDom() {
    this.draft.menuType = document.getElementById('mb-type')?.value || 'full';
    this.draft.pageSize = document.getElementById('mb-size')?.value || 'A4';
    this.draft.orientation = document.querySelector('input[name="mb-ori"]:checked')?.value || 'portrait';
    this.draft.includeLogo = !!document.getElementById('mb-inc-logo')?.checked;
    this.draft.includeBranch = !!document.getElementById('mb-inc-branch')?.checked;
    this.draft.includePhone = !!document.getElementById('mb-inc-phone')?.checked;
    this.draft.includeDate = !!document.getElementById('mb-inc-date')?.checked;
    this.draft.includeFooter = !!document.getElementById('mb-inc-footer')?.checked;
    this.draft.customTitle = document.getElementById('mb-title')?.value || 'Our Menu';
    this.draft.footerText = document.getElementById('mb-footer')?.value || '';
  },

  bindProductChecks() {
    this.el?.querySelectorAll('#mb-prod-list input[data-pid]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = Number(inp.dataset.pid);
        if (inp.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        inp.closest('.mb-prod-row')?.classList.toggle('is-on', inp.checked);
        const count = document.getElementById('mb-sel-count');
        if (count) count.textContent = `${this.selectedIds.size} selected`;
      });
    });
  },

  bindBuilder() {
    document.getElementById('mb-branch')?.addEventListener('change', (e) => {
      this.branchId = e.target.value;
      this.readDraftFromDom();
    });
    const searchInput = document.getElementById('mb-search');
    const resultsEl = document.getElementById('mb-search-results');
    let searchTimer = null;
    searchInput?.addEventListener('input', (e) => {
      this.searchQ = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.refreshProductList();
        this.paintSearchResults(this.searchQ);
      }, 80);
    });
    searchInput?.addEventListener('focus', () => {
      if (String(searchInput.value || '').trim()) this.paintSearchResults(searchInput.value);
    });
    searchInput?.addEventListener('blur', () => {
      setTimeout(() => resultsEl?.classList.add('hidden'), 160);
    });
    document.getElementById('mb-select-visible')?.addEventListener('click', () => {
      this.filteredProducts(this.searchQ).forEach((p) => this.selectedIds.add(Number(p.id)));
      this.refreshProductList();
    });
    document.getElementById('mb-clear')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.refreshProductList();
    });
    document.getElementById('mb-reload-prods')?.addEventListener('click', async () => {
      this.products = [];
      this.productsLoading = true;
      this.refreshProductList();
      await this.loadProducts();
      this.refreshProductList();
      this.toast(this.products.length ? `${this.products.length} products loaded` : 'No products found', this.products.length ? 'success' : 'error');
    });
    this.bindProductChecks();
    document.getElementById('mb-swatches')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme]');
      if (!btn) return;
      this.readDraftFromDom();
      this.draft.theme = btn.dataset.theme;
      this.paintBuilder();
    });
    document.getElementById('mb-generate')?.addEventListener('click', () => this.generate());
    this.bindActions();
  },

  bindActions() {
    document.getElementById('mb-fullscreen')?.addEventListener('click', () => this.openFullscreen());
    document.getElementById('mb-pdf')?.addEventListener('click', () => this.savePdf());
    document.getElementById('mb-print')?.addEventListener('click', () => this.printMenu());
    document.getElementById('mb-wa')?.addEventListener('click', () => this.shareWhatsApp(false));
    document.getElementById('mb-wa-group')?.addEventListener('click', () => this.shareWhatsApp(true));
  },

  canvasSize() {
    const size = this.SIZES[this.draft.pageSize] || this.SIZES.A4;
    let wMm = size.w;
    let hMm = size.h;
    if (this.draft.orientation === 'landscape' && this.draft.pageSize !== 'square') {
      wMm = size.h;
      hMm = size.w;
    }
    // ~3.78 px per mm at ~96dpi for crisp export; scale up for print quality
    const scale = this.draft.pageSize === 'A1' || this.draft.pageSize === 'A2' ? 2.5
      : this.draft.pageSize === 'social' ? 10
      : 4;
    return { w: Math.round(wMm * scale), h: Math.round(hMm * scale), wMm, hMm };
  },

  productsPerPage(W, H) {
    const sizeKey = this.draft.pageSize;
    if (sizeKey === 'social') return { cols: 2, rows: 3 };
    if (sizeKey === 'square') return { cols: 2, rows: 2 };
    if (sizeKey === 'flyer' || sizeKey === 'A5') return { cols: 2, rows: 3 };
    if (sizeKey === 'A4') return this.draft.orientation === 'landscape' ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
    if (sizeKey === 'A3') return this.draft.orientation === 'landscape' ? { cols: 4, rows: 3 } : { cols: 3, rows: 4 };
    if (sizeKey === 'A2' || sizeKey === 'A1') return this.draft.orientation === 'landscape' ? { cols: 5, rows: 3 } : { cols: 3, rows: 5 };
    return { cols: 2, rows: 4 };
  },

  async generate() {
    this.readDraftFromDom();
    if (!this.products.length) {
      await this.loadProducts();
    }
    const selected = this.selectedProducts();
    if (!selected.length) return this.toast('Search and mark at least one product', 'error');
    const btn = document.getElementById('mb-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const { w: W, h: H } = this.canvasSize();
      const grid = this.productsPerPage(W, H);
      const perPage = grid.cols * grid.rows;
      const chunks = [];
      for (let i = 0; i < selected.length; i += perPage) {
        chunks.push(selected.slice(i, i + perPage));
      }
      const shop = this.shopBlock();
      const theme = this.THEMES[this.draft.theme] || this.THEMES.red;
      const logoImg = this.draft.includeLogo
        ? await (window.PromoPoster?.loadImage?.(shop.logoUrl) || this.loadImage(shop.logoUrl))
        : null;
      const pages = [];
      for (let pi = 0; pi < chunks.length; pi++) {
        const imgs = await Promise.all(chunks[pi].map(async (p) => ({
          product: p,
          img: await (window.PromoPoster?.loadImage?.(this.productImageUrl(p)) || this.loadImage(this.productImageUrl(p)))
        })));
        const canvas = this.renderPage({
          W, H, theme, shop, logoImg, items: imgs, grid, pageIndex: pi, pageCount: chunks.length
        });
        pages.push({ canvas, dataUrl: canvas.toDataURL('image/png') });
      }
      this.generatedPages = pages;
      this.toast(`Menu ready — ${pages.length} page${pages.length > 1 ? 's' : ''}`, 'success');
      this.paintBuilder();
    } catch (err) {
      this.toast(err?.message || 'Could not generate menu', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Menu'; }
    }
  },

  loadImage(url) {
    if (window.PromoPoster?.loadImage) return PromoPoster.loadImage(url);
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  },

  roundRect(ctx, x, y, w, h, r) {
    if (window.PromoPoster?.roundRect) return PromoPoster.roundRect(ctx, x, y, w, h, r);
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  },

  drawCover(ctx, img, x, y, w, h) {
    if (window.PromoPoster?.drawCoverImage) return PromoPoster.drawCoverImage(ctx, img, x, y, w, h);
    if (!img) return;
    const ir = img.width / img.height;
    const dr = w / h;
    let sw, sh, sx, sy;
    if (ir > dr) { sh = img.height; sw = sh * dr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / dr; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  },

  renderPage({ W, H, theme, shop, logoImg, items, grid, pageIndex, pageCount }) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const t = theme;
    const pad = Math.round(W * 0.04);

    // Background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.bg);
    g.addColorStop(0.5, t.card);
    g.addColorStop(1, t.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    let y = pad;

    // Header: logo + shop name
    const headerH = Math.round(H * 0.11);
    if (logoImg && this.draft.includeLogo) {
      const lh = Math.round(headerH * 0.7);
      const lw = lh;
      this.drawCover(ctx, logoImg, pad, y, lw, lh);
      ctx.fillStyle = t.text;
      ctx.font = `bold ${Math.round(W * 0.035)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(shop.shopName, pad + lw + Math.round(W * 0.02), y + lh / 2 - Math.round(H * 0.012));
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(W * 0.018)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(this.draft.footerText || 'Taste the fire. Feel the flavour.', pad + lw + Math.round(W * 0.02), y + lh / 2 + Math.round(H * 0.018));
    } else {
      ctx.fillStyle = t.text;
      ctx.font = `bold ${Math.round(W * 0.045)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(shop.shopName, pad, y + Math.round(headerH * 0.35));
    }

    // Branch bar
    y += headerH;
    const barH = Math.round(H * 0.035);
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, pad, y, W - pad * 2, barH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.round(W * 0.016)}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const bits = [];
    if (this.draft.includeBranch && shop.branchName) bits.push(shop.branchName);
    if (this.draft.includeBranch && shop.address) bits.push(shop.address);
    if (this.draft.includePhone && shop.phone) bits.push(shop.phone);
    if (shop.hours) bits.push(shop.hours);
    if (this.draft.includeDate) bits.push(shop.date);
    ctx.fillText(bits.join('  ·  ') || shop.shopName, pad + 12, y + barH / 2);

    // Title banner
    y += barH + Math.round(H * 0.02);
    const titleH = Math.round(H * 0.055);
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, pad, y, W - pad * 2, titleH, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(W * 0.04)}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.draft.customTitle || 'OUR MENU').toUpperCase(), W / 2, y + titleH / 2);

    // Product grid
    y += titleH + Math.round(H * 0.02);
    const footerReserve = this.draft.includeFooter ? Math.round(H * 0.12) : Math.round(H * 0.04);
    const gridBottom = H - pad - footerReserve;
    const gridH = gridBottom - y;
    const gap = Math.round(W * 0.015);
    const cols = grid.cols;
    const rows = grid.rows;
    const cellW = (W - pad * 2 - gap * (cols - 1)) / cols;
    const cellH = (gridH - gap * (rows - 1)) / rows;

    items.forEach((slot, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      if (row >= rows) return;
      const x = pad + col * (cellW + gap);
      const cy = y + row * (cellH + gap);
      this.paintProductCard(ctx, slot, x, cy, cellW, cellH, t, shop.currency);
    });

    // Footer promo strip
    if (this.draft.includeFooter) {
      const fy = H - pad - Math.round(H * 0.1);
      const fh = Math.round(H * 0.09);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      this.roundRect(ctx, pad, fy, W - pad * 2, fh, 12);
      ctx.fill();
      ctx.fillStyle = t.text;
      ctx.font = `bold ${Math.round(W * 0.022)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ORDER NOW', pad + 20, fy + fh * 0.4);
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(W * 0.016)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(shop.phone ? `WhatsApp ${shop.phone}` : (this.draft.footerText || ''), pad + 20, fy + fh * 0.7);
      // Free delivery badge
      ctx.fillStyle = t.accent;
      this.roundRect(ctx, W - pad - Math.round(W * 0.22), fy + fh * 0.2, Math.round(W * 0.2), fh * 0.6, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(W * 0.014)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('FREE DELIVERY', W - pad - Math.round(W * 0.12), fy + fh * 0.5);
      if (pageCount > 1) {
        ctx.fillStyle = t.muted;
        ctx.font = `${Math.round(W * 0.012)}px system-ui,Segoe UI,sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(`Page ${pageIndex + 1} / ${pageCount}`, W - pad, H - pad / 2);
      }
    }

    return canvas;
  },

  paintProductCard(ctx, slot, x, y, w, h, t, currency) {
    const p = slot.product;
    const img = slot.img;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    this.roundRect(ctx, x, y, w, h, 14);
    ctx.fill();

    const imgSize = Math.min(w * 0.55, h * 0.48);
    const ix = x + (w - imgSize) / 2;
    const iy = y + h * 0.08;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ix + imgSize / 2, iy + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img) this.drawCover(ctx, img, ix, iy, imgSize, imgSize);
    else {
      ctx.fillStyle = '#334155';
      ctx.fillRect(ix, iy, imgSize, imgSize);
    }
    ctx.restore();

    const nameY = iy + imgSize + h * 0.08;
    ctx.fillStyle = t.text;
    ctx.font = `bold ${Math.round(w * 0.09)}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const name = String(p.name || 'Item');
    this.wrapText(ctx, name, x + w / 2, nameY, w * 0.9, Math.round(w * 0.1), 2);

    const desc = p.description || p.category_name || '';
    if (desc) {
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(w * 0.065)}px system-ui,Segoe UI,sans-serif`;
      this.wrapText(ctx, String(desc), x + w / 2, nameY + Math.round(w * 0.22), w * 0.88, Math.round(w * 0.08), 1);
    }

    // Price badge
    const price = this.money(p.selling_price).replace(/\.00$/, '');
    const pw = Math.max(w * 0.45, ctx.measureText(price).width + w * 0.15);
    const ph = h * 0.12;
    const px = x + (w - pw) / 2;
    const py = y + h - ph - h * 0.06;
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, px, py, pw, ph, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(w * 0.1)}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(price, x + w / 2, py + ph / 2);
  },

  wrapText(ctx, text, cx, y, maxW, lineH, maxLines) {
    const words = String(text).split(/\s+/);
    let line = '';
    let lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, y + lines * lineH);
        lines += 1;
        line = words[i];
        if (lines >= maxLines) return;
      } else line = test;
    }
    if (line && lines < maxLines) ctx.fillText(line, cx, y + lines * lineH);
  },

  openFullscreen() {
    if (!this.generatedPages.length) return;
    const w = window.open('', '_blank');
    if (!w) return this.toast('Allow pop-ups to view full screen', 'error');
    const imgs = this.generatedPages.map((p, i) =>
      `<div style="margin:0 0 24px;text-align:center"><img src="${p.dataUrl}" style="max-width:100%;height:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)"><p style="color:#94a3b8">Page ${i + 1}</p></div>`
    ).join('');
    w.document.write(`<!DOCTYPE html><html><head><title>Menu Preview</title>
      <style>body{margin:0;background:#0f172a;padding:24px;font-family:system-ui}</style></head>
      <body>${imgs}</body></html>`);
    w.document.close();
  },

  printMenu() {
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    const w = window.open('', '_blank');
    if (!w) return this.toast('Allow pop-ups to print', 'error');
    const size = this.SIZES[this.draft.pageSize] || this.SIZES.A4;
    let wMm = size.w;
    let hMm = size.h;
    if (this.draft.orientation === 'landscape' && this.draft.pageSize !== 'square') {
      wMm = size.h;
      hMm = size.w;
    }
    const imgs = this.generatedPages.map((p) =>
      `<div class="page"><img src="${p.dataUrl}"></div>`
    ).join('');
    w.document.write(`<!DOCTYPE html><html><head><title>Print Menu</title>
      <style>
        @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
        html, body { margin: 0; padding: 0; }
        .page { page-break-after: always; width: ${wMm}mm; height: ${hMm}mm; overflow: hidden; }
        .page:last-child { page-break-after: auto; }
        img { width: 100%; height: 100%; object-fit: contain; display: block; }
      </style></head><body>${imgs}
      <script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script>
      </body></html>`);
    w.document.close();
  },

  downloadPngPages() {
    const shop = this.shopBlock();
    const base = `menu-${String(shop.shopName).replace(/\W+/g, '-').toLowerCase()}`;
    this.generatedPages.forEach((pg, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.download = `${base}-p${i + 1}.png`;
        a.href = pg.dataUrl;
        a.click();
      }, i * 350);
    });
  },

  async savePdf() {
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    this.downloadPngPages();
    this.printMenu();
    this.toast('Images saved — in the print dialog choose Save as PDF', 'info');
  },

  dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(parts[1] || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  },

  async shareWhatsApp(toGroup) {
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    if (!this.waSettings || (!this.waSettings.business_group_link && !this.waSettings.whatsapp_business_group_link)) {
      try {
        const wa = await API.getWhatsAppSettings?.();
        this.waSettings = wa?.data || wa || this.waSettings || {};
      } catch (_) { this.waSettings = this.waSettings || {}; }
    }
    const shop = this.shopBlock();
    const msg = `${shop.shopName} — ${this.draft.customTitle || 'Our Menu'}\n${shop.branchName ? shop.branchName + '\n' : ''}${shop.phone ? 'Call/WhatsApp: ' + shop.phone + '\n' : ''}See our latest menu.`;

    // Native share with image when available (mobile / supported browsers)
    try {
      if (navigator.share && navigator.canShare) {
        const files = this.generatedPages.map((pg, i) =>
          new File([this.dataUrlToBlob(pg.dataUrl)], `menu-page-${i + 1}.png`, { type: 'image/png' })
        );
        if (navigator.canShare({ files })) {
          await navigator.share({ files, title: shop.shopName, text: msg });
          return;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }

    this.downloadPngPages();
    try { await navigator.clipboard.writeText(msg); } catch (_) { /* */ }

    if (toGroup) {
      const link = this.waSettings?.business_group_link || this.waSettings?.whatsapp_business_group_link || '';
      if (!link) return this.toast('Connect WhatsApp business group in Admin first', 'error');
      window.open(link, '_blank', 'noopener');
      this.toast('Group opened — attach the saved menu image(s) and paste the message', 'success');
      return;
    }
    const phone = shop.phone || '';
    if (typeof Utils !== 'undefined' && Utils.whatsappUrl && phone) {
      window.open(Utils.whatsappUrl(phone, msg), '_blank', 'noopener');
      this.toast('WhatsApp opened — attach the saved menu image(s)', 'success');
    } else if (typeof Utils !== 'undefined' && Utils.openWhatsApp) {
      Utils.openWhatsApp(phone, msg);
    } else {
      this.toast('Message copied — open WhatsApp and attach the menu image(s)', 'success');
    }
  }
};
