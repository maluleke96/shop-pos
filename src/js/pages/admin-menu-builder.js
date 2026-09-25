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
    includeOrderLink: true,
    customTitle: 'Our Menu',
    footerText: '',
    deliveryText: 'FREE DELIVERY for orders R50+',
    gridMode: 'auto', // auto | custom
    gridCols: 2,
    gridRows: 4,
    headerBannerDataUrl: '',
    infoFontScale: 1, // location / phone / hours on red bar
    imageScale: 1, // product photo size
    centerSingle: true, // center when only one product on the page
    shopNameScale: 1,
    includeSlogan: true, // "Thank you…" / slogan under company name
    sloganScale: 1,
    logoShape: 'circle', // circle | square
    productImageShape: 'circle', // circle | square
    headerAlign: 'left', // left | center | right
    orderFontScale: 1, // ORDER NOW + WhatsApp + link
    deliveryScale: 1, // free-delivery circle size
    itemNameScale: 1, // product name size (all items)
    priceScale: 1, // product price size
    // Name + price placement on each product card (simple shared position)
    textPosition: 'bottom-center', // 9-point: top-left … bottom-right
    namePosition: '', // optional independent override
    pricePosition: '', // optional independent override
    nameColor: '',
    priceColor: '',
    textAlign: 'center', // left | center | right
    textBackground: true,
    textPadding: 1, // relative padding scale
    priceOverrides: {}, // { [productId]: number }
    buyGetOffers: [{ buyIds: [], freeIds: [], freeImageDataUrl: '' }],
    // Buy X Get Free block — independent element sizing (does not resize other menu sections)
    buyGetBlock: {
      size: 'medium', // small | medium | large | custom | auto
      layout: 'auto', // auto | horizontal | vertical
      customWidthPct: 92,
      customHeightPct: 55,
      spacing: 1, // relative gap scale
      padding: 1, // relative inner padding scale
      align: 'center', // left | center | right
      imageShape: 'circle', // circle | square | rounded | rectangle
      imageScale: 1,
      textScale: 1,
      priceScale: 1,
      title: 'BUY X GET X FREE'
    },
    qrScale: 1,
    dateScale: 1,
    includeQr: true,
    includeSocials: true,
    socialFacebook: '',
    socialInstagram: '',
    socialTiktok: '',
    socialWhatsapp: '',
    socialWebsite: '',
    menuLanguage: 'en'
  },
  headerBannerImg: null,
  settingsTab: 'layout', // layout | header | products | footer | prices | offers | socials
  offerPickMode: 'buy', // buy | free — click products to assign
  activeOfferIndex: 0,
  offerSubTab: 'content', // content | style | size

  LANGS: {
    en: {
      orderNow: 'ORDER NOW', openDailyFrom: 'Open daily from', to: 'to',
      buy: 'BUY', get: 'GET', getFree: 'GET FREE', free: 'FREE', was: 'was',
      specialOffer: '★ SPECIAL OFFER ★', buyGetBanner: '★ BUY & GET FREE ★',
      scanToOrder: 'Scan to order'
    },
    af: {
      orderNow: 'BESTEL NOU', openDailyFrom: 'Daagliks oop van', to: 'tot',
      buy: 'KOOP', get: 'KRY', getFree: 'KRY GRATIS', free: 'GRATIS', was: 'was',
      specialOffer: '★ SPESIALE AANBIEDING ★', buyGetBanner: '★ KOOP X KRY GRATIS ★',
      scanToOrder: 'Skandeer om te bestel'
    },
    zu: {
      orderNow: 'ODA MANJE', openDailyFrom: 'Ivula nsuku zonke kusukela', to: 'kuya',
      buy: 'THENGA', get: 'THOLA', getFree: 'THOLA MAHALA', free: 'MAHALA', was: 'kwakuyi',
      specialOffer: '★ ISPECIAL ★', buyGetBanner: '★ THENGA X THOLA MAHALA ★',
      scanToOrder: 'Skena ukuze u-ode'
    },
    xh: {
      orderNow: 'ODA NGOKU', openDailyFrom: 'Ivula yonke imihla ukusuka', to: 'ukuya',
      buy: 'THENGA', get: 'FUMANA', getFree: 'FUMANA SIMAHLA', free: 'SIMAHLA', was: 'yayiyi',
      specialOffer: '★ ISPECIAL ★', buyGetBanner: '★ THENGA X FUMANA SIMAHLA ★',
      scanToOrder: 'Skena ukuze u-ode'
    },
    nso: {
      orderNow: 'ODARA BJALE', openDailyFrom: 'E bula letšatši le lengwe le le lengwe go tloga', to: 'go fihla',
      buy: 'REKA', get: 'HWEŠA', getFree: 'HWEŠA MAHALA', free: 'MAHALA', was: 'e be e le',
      specialOffer: '★ SPECIAL ★', buyGetBanner: '★ REKA X HWEŠA MAHALA ★',
      scanToOrder: 'Skena go odara'
    },
    st: {
      orderNow: 'ODARA HAJOALE', openDailyFrom: 'E bula matsatsi ohle ho tloha', to: 'ho isa',
      buy: 'REKA', get: 'FUMANA', getFree: 'FUMANA MAHALA', free: 'MAHALA', was: 'e ne e le',
      specialOffer: '★ SPECIAL ★', buyGetBanner: '★ REKA X FUMANA MAHALA ★',
      scanToOrder: 'Skena ho odara'
    },
    tn: {
      orderNow: 'ODARA JAANONG', openDailyFrom: 'E bula malatsi otlhe go tswa', to: 'go ya',
      buy: 'REKA', get: 'BONA', getFree: 'BONA MAHALA', free: 'MAHALA', was: 'e ne e le',
      specialOffer: '★ SPECIAL ★', buyGetBanner: '★ REKA X BONA MAHALA ★',
      scanToOrder: 'Skena go odara'
    },
    ve: {
      orderNow: 'ODARA ZWAZWINO', openDailyFrom: 'I vula ḓuvha ḽiṅwe na ḽiṅwe u bva', to: 'u swika',
      buy: 'RENGISA', get: 'WANIWA', getFree: 'WANIWA MAHALA', free: 'MAHALA', was: 'yo vha i',
      specialOffer: '★ SPECIAL ★', buyGetBanner: '★ RENGISA X WANIWA MAHALA ★',
      scanToOrder: 'Skena u odara'
    },
    ts: {
      orderNow: 'ODARA SWESWI', openDailyFrom: 'Yi pfula siku rin’wana na rin’wana ku suka', to: 'ku fika',
      buy: 'XAVA', get: 'KUMA', getFree: 'KUMA MAHALA', free: 'MAHALA', was: 'a yi ri',
      specialOffer: '★ SPECIAL ★', buyGetBanner: '★ XAVA X KUMA MAHALA ★',
      scanToOrder: 'Skena ku odara'
    }
  },

  lang() {
    return this.LANGS[this.draft.menuLanguage] || this.LANGS.en;
  },
  L(key) {
    return this.lang()[key] || this.LANGS.en[key] || key;
  },

  PRESETS: {
    poster: {
      imageScale: 1.25, itemNameScale: 1.2, shopNameScale: 1.15, sloganScale: 1.05,
      deliveryScale: 1.3, orderFontScale: 1.15, infoFontScale: 1.1, centerSingle: true
    },
    compact: {
      imageScale: 0.85, itemNameScale: 0.9, shopNameScale: 1, sloganScale: 0.95,
      deliveryScale: 0.9, orderFontScale: 0.95, infoFontScale: 0.9, centerSingle: false
    },
    specials: {
      menuType: 'specials', customTitle: "Today's Specials",
      imageScale: 1.35, itemNameScale: 1.25, shopNameScale: 1.1, sloganScale: 1,
      deliveryScale: 1.25, orderFontScale: 1.1, infoFontScale: 1.05, centerSingle: true
    }
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
    const href = `css/menu-builder.css?v=12`;
    let l = document.getElementById('menu-builder-css');
    if (l) {
      if (!String(l.getAttribute('href') || '').includes('v=11')) l.href = href;
      return;
    }
    l = document.createElement('link');
    l.id = 'menu-builder-css';
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  },

  alignIcons(name, value) {
    const cur = value || 'left';
    const opts = [
      { v: 'left', title: 'Align left', icon: '⬅' },
      { v: 'center', title: 'Align centre', icon: '☰' },
      { v: 'right', title: 'Align right', icon: '➡' }
    ];
    return `<div class="mb-align-group" role="group" aria-label="Alignment">
      ${opts.map((o) => `<button type="button" class="mb-align-btn ${cur === o.v ? 'active' : ''}" data-align-name="${name}" data-align="${o.v}" title="${o.title}">${o.icon}</button>`).join('')}
    </div>`;
  },

  /** 9-point position pad for name/price on product cards */
  positionPad(name, value) {
    const cur = value || 'bottom-center';
    const cells = [
      ['top-left', '↖', 'Top left'], ['top-center', '↑', 'Top centre'], ['top-right', '↗', 'Top right'],
      ['middle-left', '←', 'Middle left'], ['center', '●', 'Centre'], ['middle-right', '→', 'Middle right'],
      ['bottom-left', '↙', 'Bottom left'], ['bottom-center', '↓', 'Bottom centre'], ['bottom-right', '↘', 'Bottom right']
    ];
    return `<div class="mb-pos-pad" role="group" aria-label="Text position" data-pos-name="${name}">
      ${cells.map(([v, icon, title]) =>
        `<button type="button" class="mb-pos-btn ${cur === v ? 'active' : ''}" data-pos-name="${name}" data-pos="${v}" title="${title}">${icon}</button>`
      ).join('')}
    </div>`;
  },

  toggleRow(id, label, checked) {
    return `<label class="mb-toggle-row" for="${id}">
      <span class="mb-toggle-label">${label}</span>
      <span class="mb-toggle-ctrl">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
        <span class="mb-toggle-track" aria-hidden="true"></span>
      </span>
    </label>`;
  },

  sliderField(id, label, scale, hint, min = 60, max = 200) {
    const pct = Math.round((Number(scale) || 1) * 100);
    return `<div class="field mb-slider-field">
      <div class="mb-slider-head">
        <label for="${id}">${label}</label>
        <span class="mb-slider-val" id="${id}-val">${pct}%</span>
      </div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="5" value="${pct}">
      ${hint ? `<p class="mb-field-hint">${hint}</p>` : ''}
    </div>`;
  },

  formatTimeLabel(hhmm) {
    const raw = String(hhmm || '').trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return raw || '';
    let h = Number(m[1]);
    const min = m[2];
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return min === '00' ? `${h} ${ap}` : `${h}:${min} ${ap}`;
  },

  resolveOpeningHoursText() {
    const b = this.selectedBranch();
    const s = this.settings || {};
    const oh = s.operating_hours_settings
      || this.app?.settings?.operating_hours_settings
      || this.app?.getOperatingSettings?.()
      || {};
    const weekly = Array.isArray(oh.weekly) ? oh.weekly : null;
    let open = oh.open_time;
    let close = oh.close_time;
    if (weekly && weekly.length) {
      const opens = weekly.filter((d) => !d.closed).map((d) => d.open || open || '08:00');
      const closes = weekly.filter((d) => !d.closed).map((d) => d.close || close || '18:00');
      if (opens.length && closes.length) {
        const sameOpen = opens.every((v) => v === opens[0]);
        const sameClose = closes.every((v) => v === closes[0]);
        if (sameOpen && sameClose) {
          open = opens[0];
          close = closes[0];
        } else {
          const today = weekly.find((d) => Number(d.day) === new Date().getDay()) || weekly.find((d) => !d.closed) || weekly[0];
          if (today && !today.closed) {
            open = today.open || open;
            close = today.close || close;
          }
        }
      }
    }
    if (open && close) {
      return `${this.L('openDailyFrom')} ${this.formatTimeLabel(open)} ${this.L('to')} ${this.formatTimeLabel(close)}`;
    }
    const raw = b?.opening_hours || b?.hours || s.operating_hours_text || '';
    if (raw) {
      const t = String(raw);
      if (/from\s+/i.test(t) || /open daily/i.test(t)) return t;
      return `Open daily from ${t}`;
    }
    return 'Open daily from 7 AM to 9 PM';
  },

  menuPrice(p) {
    const id = Number(p?.id);
    const ov = this.draft.priceOverrides?.[id];
    if (ov != null && ov !== '' && !Number.isNaN(Number(ov))) return Number(ov);
    return Number(p?.selling_price) || 0;
  },

  priceOverridesHtml() {
    const selected = this.selectedProducts();
    if (!selected.length) {
      return `<p class="mb-field-hint">Select products to edit menu prices (does not change stock prices).</p>`;
    }
    return `<div class="mb-price-list">${selected.slice(0, 40).map((p) => {
      const id = Number(p.id);
      const val = this.draft.priceOverrides?.[id];
      const stock = Number(p.selling_price) || 0;
      const shown = val != null && val !== '' ? val : stock;
      const changed = val != null && val !== '' && Math.abs(Number(val) - stock) > 0.001;
      return `<label class="mb-price-row">
        <span class="mb-price-name" title="${this.esc(p.name)}">${this.esc(p.name)}${changed ? ` <em class="mb-was-hint">${this.L('was')} ${this.esc(this.money(stock))}</em>` : ''}</span>
        <input type="number" class="mb-price-input" data-price-pid="${id}" min="0" step="0.01" value="${this.esc(shown)}">
      </label>`;
    }).join('')}</div>
    <p class="mb-field-hint">If you change a price, the menu shows “was …” struck through and the new price.</p>`;
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
        || 'Thank you for your purchase!';
    }
    if (!this.draft.deliveryText) {
      this.draft.deliveryText = 'FREE DELIVERY for orders R50+';
    }
    if (!this.draft.customTitle || this.draft.customTitle === 'Our Menu') {
      if (this.draft.menuType === 'specials') this.draft.customTitle = "Today's Specials";
      else if (this.draft.menuType === 'takeaway') this.draft.customTitle = 'Takeaway Menu';
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
    const [br, st, oh] = await Promise.all([
      API.getBranches?.().catch(() => null),
      API.getSettingsParsed?.().catch(() => null),
      API.getOperatingHours?.().catch(() => null)
    ]);
    let branches = br?.success !== false ? (br?.data ?? br ?? []) : [];
    if (!Array.isArray(branches)) branches = [];
    this.branches = branches;
    this.settings = st?.data || st || this.app?.settings || this.settings || {};
    const hours = oh?.success !== false ? (oh?.data || oh) : null;
    if (hours && typeof hours === 'object') {
      this.settings = { ...this.settings, operating_hours_settings: hours };
      if (this.app?.settings) {
        this.app.settings = { ...this.app.settings, operating_hours_settings: hours };
      }
    }
    if (!this.draft.footerText) {
      this.draft.footerText = this.settings.receipt_footer
        || this.settings.slogan
        || 'Thank you for your purchase!';
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
      hours: this.resolveOpeningHoursText(),
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
      const offer = (this.draft.buyGetOffers || [])[this.activeOfferIndex || 0] || { buyIds: [], freeIds: [] };
      const isBuy = (offer.buyIds || []).map(Number).includes(id);
      const isFree = (offer.freeIds || []).map(Number).includes(id);
      const badge = isBuy ? '<span class="mb-chip buy">BUY</span>' : (isFree ? '<span class="mb-chip free">FREE</span>' : '');
      return `<label class="mb-prod-row ${on || isBuy || isFree ? 'is-on' : ''}" data-prod-row="${id}">
        <input type="checkbox" data-pid="${id}" ${on ? 'checked' : ''}>
        <span class="mb-thumb">${img ? `<img src="${this.esc(img)}" alt="" loading="lazy" onerror="this.parentNode.textContent='•'">` : '•'}</span>
        <span class="mb-prod-meta">
          <strong>${this.esc(p.name)} ${badge}</strong>
          <small>${this.money(this.menuPrice(p))}${this.draft.priceOverrides?.[id] != null ? ' · menu' : ''}</small>
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
          <div class="mb-settings-head">
            <h3>Menu Settings</h3>
            <span class="mb-settings-tag">${this.esc((this.settingsTab || 'layout').replace(/^\w/, (c) => c.toUpperCase()))}</span>
          </div>
          ${this.settingsTabsHtml()}
          <div class="mb-settings-scroll" id="mb-settings-pane">
            ${this.settingsPaneHtml()}
          </div>
          <button type="button" class="btn btn-primary mb-generate" id="mb-generate" style="background:${theme.accent}">
            Generate Menu
          </button>
          <p class="mb-shop-hint">${this.esc(shop.shopName)}${shop.branchName ? ` · ${this.esc(shop.branchName)}` : ''}</p>
        </section>

        <section class="mb-col mb-col-preview">
          <h3>Preview</h3>
          <div class="mb-preview-stage ${this.draft.orientation === 'landscape' ? 'is-landscape' : ''}" id="mb-preview-stage">
            ${this.generatedPages.length
              ? this.generatedPages.map((pg, i) =>
                `<div class="mb-preview-page ${this.draft.orientation === 'landscape' ? 'is-landscape' : ''}"><img src="${pg.dataUrl}" alt="Menu page ${i + 1}"><span class="mb-page-tag">Page ${i + 1}</span></div>`
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
    const priceBox = document.getElementById('mb-price-overrides');
    if (priceBox) {
      priceBox.innerHTML = this.priceOverridesHtml();
      this.bindPriceInputs();
    }
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
    const hasSel = this.selectedIds.size > 0 || this.draft.menuType === 'buyget';
    return `<div class="mb-action-bar">
      <button type="button" class="btn btn-ghost" id="mb-fullscreen" ${ready ? '' : 'disabled'}>View Full Screen</button>
      <button type="button" class="btn btn-primary" id="mb-pdf" ${ready ? '' : 'disabled'}>Print PDF</button>
      <button type="button" class="btn btn-ghost" id="mb-png" ${ready ? '' : 'disabled'}>PNG (HD)</button>
      <button type="button" class="btn btn-ghost" id="mb-jpg" ${ready ? '' : 'disabled'}>JPEG (HD)</button>
      <button type="button" class="btn btn-ghost" id="mb-social" ${ready ? '' : 'disabled'}>Social / WhatsApp size</button>
      <button type="button" class="btn btn-ghost" id="mb-print" ${ready ? '' : 'disabled'}>Print</button>
      <button type="button" class="btn btn-primary" id="mb-create-video" ${hasSel ? '' : 'disabled'} title="Open Promo Video Builder with this menu">🎬 Create Video From Menu</button>
      <button type="button" class="btn mb-btn-wa" id="mb-wa" ${ready ? '' : 'disabled'}>Share to WhatsApp</button>
      <button type="button" class="btn mb-btn-group" id="mb-wa-group" ${ready ? '' : 'disabled'}>Share to Group</button>
      <button type="button" class="btn btn-primary" id="mb-cc-share" ${ready ? '' : 'disabled'}>📤 Share / Publish</button>
      <span class="mb-action-hint">High-resolution exports for print, WhatsApp and social media.</span>
    </div>`;
  },

  settingsTabsHtml() {
    const tabs = [
      { id: 'layout', label: 'Layout' },
      { id: 'header', label: 'Header' },
      { id: 'products', label: 'Products' },
      { id: 'offers', label: 'Buy & Free' },
      { id: 'footer', label: 'Footer' },
      { id: 'socials', label: 'Socials' },
      { id: 'prices', label: 'Prices' }
    ];
    const cur = this.settingsTab || 'layout';
    return `<div class="mb-tabs" role="tablist">
      ${tabs.map((t) => `<button type="button" class="mb-tab ${cur === t.id ? 'active' : ''}" data-mb-tab="${t.id}" role="tab" aria-selected="${cur === t.id}">${t.label}</button>`).join('')}
    </div>`;
  },

  buyGetOffersHtml() {
    if (!Array.isArray(this.draft.buyGetOffers) || !this.draft.buyGetOffers.length) {
      this.draft.buyGetOffers = [{ buyIds: [], freeIds: [], freeImageDataUrl: '' }];
    }
    if (!this.draft.buyGetBlock || typeof this.draft.buyGetBlock !== 'object') {
      this.draft.buyGetBlock = {
        size: 'medium', layout: 'auto', customWidthPct: 92, customHeightPct: 55,
        spacing: 1, padding: 1, align: 'center', imageShape: 'circle',
        imageScale: 1, textScale: 1, priceScale: 1, title: 'BUY X GET X FREE'
      };
    }
    const bg = this.draft.buyGetBlock;
    const oi = Math.min(this.activeOfferIndex || 0, this.draft.buyGetOffers.length - 1);
    this.activeOfferIndex = oi;
    const offer = this.draft.buyGetOffers[oi];
    const mode = this.offerPickMode || 'buy';
    const nameOf = (id) => {
      const p = this.products.find((x) => Number(x.id) === Number(id));
      return p ? p.name : `#${id}`;
    };
    const sizeBtn = (v, label) =>
      `<button type="button" class="mb-size-btn ${bg.size === v ? 'active' : ''}" data-bg-size="${v}">${label}</button>`;
    const layBtn = (v, label, icon) =>
      `<button type="button" class="mb-layout-btn ${bg.layout === v ? 'active' : ''}" data-bg-layout="${v}" title="${label}">${icon}<span>${label}</span></button>`;
    return `<div class="mb-offers" id="mb-offers">
      <div class="mb-offer-switch">
        ${this.draft.buyGetOffers.map((_, i) =>
          `<button type="button" class="mb-preset-btn ${i === oi ? 'active' : ''}" data-offer-active="${i}">Offer ${i + 1}</button>`
        ).join('')}
        <button type="button" class="btn btn-ghost btn-sm" id="mb-offer-add">+ Offer</button>
      </div>

      <div class="mb-selected-element">
        <div class="mb-block-title">Selected Element — Buy X Get Free Block</div>
        <div class="mb-offer-subtabs" role="tablist">
          <button type="button" class="mb-offer-subtab ${(this.offerSubTab || 'content') === 'content' ? 'active' : ''}" data-offer-sub="content">Content</button>
          <button type="button" class="mb-offer-subtab ${this.offerSubTab === 'style' ? 'active' : ''}" data-offer-sub="style">Style</button>
          <button type="button" class="mb-offer-subtab ${this.offerSubTab === 'size' ? 'active' : ''}" data-offer-sub="size">Size &amp; Position</button>
        </div>

        ${(this.offerSubTab || 'content') === 'content' ? `
        <div class="field"><label>Promotion Title</label>
          <input type="text" id="mb-bg-title" value="${this.esc(bg.title || 'BUY X GET X FREE')}">
        </div>
        <div class="mb-offer-card" data-offer-i="${oi}">
          <div class="mb-offer-head">
            <strong>Offer ${oi + 1} — click products on the left</strong>
            <button type="button" class="btn btn-ghost btn-sm mb-offer-remove" data-offer-remove="${oi}" ${this.draft.buyGetOffers.length <= 1 ? 'disabled' : ''}>Remove</button>
          </div>
          <div class="mb-pick-modes">
            <button type="button" class="mb-pick-btn ${mode === 'buy' ? 'active' : ''}" data-offer-mode="buy">1. Click for BUY</button>
            <button type="button" class="mb-pick-btn ${mode === 'free' ? 'active' : ''}" data-offer-mode="free">2. Click for GET FREE</button>
          </div>
          <p class="mb-field-hint">${mode === 'buy'
            ? 'Click products in the left list to add them under BUY for this offer.'
            : 'Click products in the left list to add them under GET FREE. Or upload a custom free picture below.'}</p>
          <div class="mb-offer-cols">
            <div>
              <div class="mb-block-title">BUY</div>
              <div class="mb-chip-list" id="mb-buy-chips">
                ${(offer.buyIds || []).length
                  ? (offer.buyIds || []).map((id) =>
                    `<button type="button" class="mb-chip buy" data-chip-remove="buy" data-pid="${id}">${this.esc(nameOf(id))} ×</button>`
                  ).join('')
                  : '<span class="mb-field-hint">No buy items yet</span>'}
              </div>
            </div>
            <div class="mb-offer-arrow">→</div>
            <div>
              <div class="mb-block-title">GET FREE</div>
              <div class="mb-chip-list" id="mb-free-chips">
                ${(offer.freeIds || []).length
                  ? (offer.freeIds || []).map((id) =>
                    `<button type="button" class="mb-chip free" data-chip-remove="free" data-pid="${id}">${this.esc(nameOf(id))} ×</button>`
                  ).join('')
                  : '<span class="mb-field-hint">No free items yet</span>'}
              </div>
            </div>
          </div>
          <div class="field" style="margin-top:12px"><label>Or upload free-item picture</label>
            <input type="file" class="mb-offer-free-img" data-offer-i="${oi}" accept="image/*">
            ${offer.freeImageDataUrl
              ? `<p class="mb-field-hint">Custom free picture ready. <button type="button" class="btn btn-ghost btn-sm mb-offer-free-clear" data-offer-i="${oi}">Remove picture</button></p>`
              : '<p class="mb-field-hint">Upload your own “get this free” image.</p>'}
          </div>
        </div>` : ''}

        ${this.offerSubTab === 'style' ? `
        <div class="field"><label>Image shape</label>
          <div class="mb-radio-row mb-shape-row">
            ${[['circle', 'Circle'], ['square', 'Square'], ['rounded', 'Rounded'], ['rectangle', 'Rectangle']].map(([v, l]) =>
              `<label><input type="radio" name="mb-bg-shape" value="${v}" ${bg.imageShape === v ? 'checked' : ''}> ${l}</label>`
            ).join('')}
          </div>
        </div>
        ${this.sliderField('mb-bg-img', 'Image size', bg.imageScale || 1, 'Scale product photos inside the block.', 50, 160)}
        ${this.sliderField('mb-bg-text', 'Name text size', bg.textScale || 1, 'Product name size inside the block.', 60, 180)}
        ${this.sliderField('mb-bg-price', 'Price size', bg.priceScale || 1, 'Price badge size inside the block.', 60, 180)}
        ${this.sliderField('mb-bg-spacing', 'Space between items', bg.spacing || 1, 'Gap between BUY and GET FREE sides.', 40, 200)}
        ${this.sliderField('mb-bg-padding', 'Padding inside block', bg.padding || 1, 'Inner padding of the promotion block.', 40, 200)}
        <div class="field"><label>Alignment</label>
          ${this.alignIcons('buyGetAlign', bg.align || 'center')}
        </div>` : ''}

        ${this.offerSubTab === 'size' ? `
        <div class="field"><label>Block size</label>
          <div class="mb-size-row">
            ${sizeBtn('small', 'Small')}
            ${sizeBtn('medium', 'Medium')}
            ${sizeBtn('large', 'Large')}
            ${sizeBtn('custom', 'Custom')}
            ${sizeBtn('auto', 'Auto-fit')}
          </div>
          <p class="mb-field-hint">Resizes only this promotion block — other menu sections stay the same.</p>
        </div>
        ${bg.size === 'custom' ? `
        <div class="field"><label>Custom width (% of menu area)</label>
          <input type="range" id="mb-bg-w" min="40" max="100" step="2" value="${Number(bg.customWidthPct) || 92}">
          <span class="mb-slider-val" id="mb-bg-w-val">${Number(bg.customWidthPct) || 92}%</span>
        </div>
        <div class="field"><label>Custom height (% of menu area)</label>
          <input type="range" id="mb-bg-h" min="25" max="95" step="2" value="${Number(bg.customHeightPct) || 55}">
          <span class="mb-slider-val" id="mb-bg-h-val">${Number(bg.customHeightPct) || 55}%</span>
        </div>` : ''}
        <div class="field"><label>Layout direction</label>
          <div class="mb-layout-row">
            ${layBtn('horizontal', 'Horizontal (Side by side)', '⬌')}
            ${layBtn('vertical', 'Vertical (Top to bottom)', '⬍')}
            ${layBtn('auto', 'Auto (by space)', '▣')}
          </div>
          <p class="mb-field-hint">Auto uses vertical when the block is narrow, horizontal when there is width.</p>
        </div>` : ''}

        <button type="button" class="btn btn-primary mb-bg-apply" id="mb-bg-apply" style="width:100%;margin-top:12px">Apply Changes / Regenerate</button>
      </div>
    </div>`;
  },

  settingsPaneHtml() {
    const tab = this.settingsTab || 'layout';
    if (tab === 'header') {
      return `
        <div class="field"><label>Header banner</label>
          <input type="file" id="mb-banner" accept="image/*">
          <p class="mb-field-hint">${this.draft.headerBannerDataUrl
            ? 'Banner sits behind logo, shop name and the red info bar.'
            : 'Upload a photo behind the logo header through the red bar.'}</p>
          ${this.draft.headerBannerDataUrl ? '<button type="button" class="btn btn-ghost btn-sm" id="mb-banner-clear">Remove banner</button>' : ''}
        </div>
        <div class="mb-settings-block">
          <div class="mb-block-title">Header include</div>
          ${this.toggleRow('mb-inc-logo', 'Shop logo', this.draft.includeLogo)}
          ${this.toggleRow('mb-inc-slogan', 'Slogan under company name', this.draft.includeSlogan !== false)}
          ${this.toggleRow('mb-inc-branch', 'Location / address', this.draft.includeBranch)}
          ${this.toggleRow('mb-inc-phone', 'WhatsApp / contact number', this.draft.includePhone)}
          ${this.toggleRow('mb-inc-date', 'Date in footer (centre)', this.draft.includeDate)}
        </div>
        <div class="field"><label>Logo shape</label>
          <div class="mb-radio-row">
            <label><input type="radio" name="mb-logo-shape" value="circle" ${this.draft.logoShape !== 'square' ? 'checked' : ''}> Circle</label>
            <label><input type="radio" name="mb-logo-shape" value="square" ${this.draft.logoShape === 'square' ? 'checked' : ''}> Square</label>
          </div>
        </div>
        <div class="field"><label>Company name &amp; slogan position</label>
          ${this.alignIcons('headerAlign', this.draft.headerAlign || 'left')}
          <p class="mb-field-hint">Left, centre or right for the shop name and slogan.</p>
        </div>
        ${this.sliderField('mb-shop-name', 'Company name size', this.draft.shopNameScale, 'Shop name next to the logo.', 70, 200)}
        ${this.sliderField('mb-slogan-scale', 'Slogan text size', this.draft.sloganScale, 'Increase the slogan under the company name.', 60, 200)}
        ${this.sliderField('mb-info-font', 'Location / phone / hours size', this.draft.infoFontScale, 'Address, contact and opening hours on the red bar (from Operating Hours).', 70, 220)}
        <div class="field"><label>Slogan / “Thank you” text</label>
          <input type="text" id="mb-footer" value="${this.esc(this.draft.footerText)}" placeholder="Thank you for your purchase!">
        </div>`;
    }
    if (tab === 'products') {
      return `
        <div class="mb-settings-block">
          <div class="mb-block-title">Product layout</div>
          ${this.toggleRow('mb-center-single', 'Centre single product', this.draft.centerSingle !== false)}
        </div>
        <div class="field"><label>Product image shape</label>
          <div class="mb-radio-row">
            <label><input type="radio" name="mb-prod-shape" value="circle" ${this.draft.productImageShape !== 'square' ? 'checked' : ''}> Circle</label>
            <label><input type="radio" name="mb-prod-shape" value="square" ${this.draft.productImageShape === 'square' ? 'checked' : ''}> Square</label>
          </div>
        </div>
        ${this.sliderField('mb-img-scale', 'Product picture size', this.draft.imageScale, 'Drag smaller or larger — photos can be tiny or dominate the card.', 25, 280)}
        ${this.sliderField('mb-item-name', 'Product name size', this.draft.itemNameScale, 'Name text size on every product card.', 50, 250)}
        ${this.sliderField('mb-price-scale', 'Product price size', this.draft.priceScale || 1, 'Price badge text size.', 50, 250)}
        <div class="field"><label>Name + price position</label>
          ${this.positionPad('textPosition', this.draft.textPosition || 'bottom-center')}
          <p class="mb-field-hint">Moves name and price together on the product card.</p>
        </div>
        <div class="field"><label>Text alignment</label>
          ${this.alignIcons('textAlign', this.draft.textAlign || 'center')}
        </div>
        <div class="form-grid" style="gap:8px">
          <div class="field"><label>Name colour</label>
            <input type="color" id="mb-name-color" value="${this.esc(this.draft.nameColor || '#f8fafc')}">
          </div>
          <div class="field"><label>Price colour</label>
            <input type="color" id="mb-price-color" value="${this.esc(this.draft.priceColor || '#ffffff')}">
          </div>
        </div>
        ${this.toggleRow('mb-text-bg', 'Text background pill', this.draft.textBackground !== false)}
        ${this.sliderField('mb-text-pad', 'Text padding', this.draft.textPadding || 1, 'Space around name/price.', 50, 180)}
        <details class="mb-advanced" style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:600">Advanced · separate name &amp; price position</summary>
          <div class="field" style="margin-top:8px"><label>Name position</label>
            ${this.positionPad('namePosition', this.draft.namePosition || this.draft.textPosition || 'bottom-center')}
          </div>
          <div class="field"><label>Price position</label>
            ${this.positionPad('pricePosition', this.draft.pricePosition || this.draft.textPosition || 'bottom-center')}
          </div>
          <p class="mb-field-hint">Leave advanced positions unused to keep name + price moving together.</p>
        </details>
        <p class="mb-field-hint">For Buy X Get Free offers, use the Buy &amp; Free tab.</p>`;
    }
    if (tab === 'offers') {
      return `
        <p class="mb-field-hint" style="margin-top:0">Set Menu Type to <strong>Buy X Get Free</strong> on Layout, then build offers here.</p>
        ${this.buyGetOffersHtml()}`;
    }
    if (tab === 'footer') {
      return `
        <div class="mb-settings-block">
          <div class="mb-block-title">Footer include</div>
          ${this.toggleRow('mb-inc-footer', 'Order footer + delivery badge', this.draft.includeFooter)}
          ${this.toggleRow('mb-inc-qr', 'Online order QR code', this.draft.includeQr !== false)}
          ${this.toggleRow('mb-inc-date', 'Show date in footer centre', this.draft.includeDate)}
          ${this.toggleRow('mb-inc-socials', 'Show socials in footer', this.draft.includeSocials !== false)}
        </div>
        ${this.sliderField('mb-order-font', 'ORDER NOW text size', this.draft.orderFontScale, 'Size of the ORDER NOW heading.', 70, 200)}
        ${this.sliderField('mb-qr-scale', 'QR code size', this.draft.qrScale || 1, 'Resize the online-order QR code.', 60, 180)}
        ${this.sliderField('mb-date-scale', 'Date size', this.draft.dateScale || 1, 'Make the footer date bigger or smaller.', 70, 220)}
        ${this.sliderField('mb-delivery-scale', 'Free delivery circle size', this.draft.deliveryScale, 'Size of the FREE DELIVERY badge.', 70, 200)}
        <div class="field"><label>Delivery badge text</label>
          <input type="text" id="mb-delivery" value="${this.esc(this.draft.deliveryText || 'FREE DELIVERY for orders R50+')}">
        </div>
        <p class="mb-field-hint">Order link text is replaced by a scannable QR. Add WhatsApp / Facebook / Instagram / TikTok / Website on the Socials tab.</p>`;
    }
    if (tab === 'socials') {
      return `
        <p class="mb-field-hint" style="margin-top:0">These appear in the menu footer. Leave blank to hide a network.</p>
        <div class="field"><label>Facebook</label>
          <input type="text" id="mb-social-fb" value="${this.esc(this.draft.socialFacebook || '')}" placeholder="facebook.com/yourpage or @page">
        </div>
        <div class="field"><label>Instagram</label>
          <input type="text" id="mb-social-ig" value="${this.esc(this.draft.socialInstagram || '')}" placeholder="@yourshop">
        </div>
        <div class="field"><label>TikTok</label>
          <input type="text" id="mb-social-tt" value="${this.esc(this.draft.socialTiktok || '')}" placeholder="@yourshop">
        </div>
        <div class="field"><label>WhatsApp</label>
          <input type="text" id="mb-social-wa" value="${this.esc(this.draft.socialWhatsapp || '')}" placeholder="071 xxx xxxx">
        </div>
        <div class="field"><label>Website</label>
          <input type="text" id="mb-social-web" value="${this.esc(this.draft.socialWebsite || '')}" placeholder="www.yourshop.co.za">
        </div>
        ${this.toggleRow('mb-inc-socials', 'Show socials on menu footer', this.draft.includeSocials !== false)}`;
    }
    if (tab === 'prices') {
      return `
        <div class="field">
          <label>Menu prices (selected products)</label>
          <div id="mb-price-overrides">${this.priceOverridesHtml()}</div>
          <p class="mb-field-hint">Edit prices for this menu only — stock prices stay unchanged.</p>
        </div>`;
    }
    // layout (default)
    return `
      <div class="field"><label>Menu language</label>
        <select id="mb-lang">
          <option value="en" ${this.draft.menuLanguage === 'en' ? 'selected' : ''}>English</option>
          <option value="af" ${this.draft.menuLanguage === 'af' ? 'selected' : ''}>Afrikaans</option>
          <option value="zu" ${this.draft.menuLanguage === 'zu' ? 'selected' : ''}>isiZulu</option>
          <option value="xh" ${this.draft.menuLanguage === 'xh' ? 'selected' : ''}>isiXhosa</option>
          <option value="nso" ${this.draft.menuLanguage === 'nso' ? 'selected' : ''}>Sepedi</option>
          <option value="st" ${this.draft.menuLanguage === 'st' ? 'selected' : ''}>Sesotho</option>
          <option value="tn" ${this.draft.menuLanguage === 'tn' ? 'selected' : ''}>Setswana</option>
          <option value="ve" ${this.draft.menuLanguage === 've' ? 'selected' : ''}>Tshivenda</option>
          <option value="ts" ${this.draft.menuLanguage === 'ts' ? 'selected' : ''}>Xitsonga</option>
        </select>
        <p class="mb-field-hint">Labels on the menu (Order now, Buy/Free, Open daily…).</p>
      </div>
      <div class="field"><label>Quick look</label>
        <div class="mb-presets" id="mb-presets">
          <button type="button" class="mb-preset-btn" data-preset="poster">Poster</button>
          <button type="button" class="mb-preset-btn" data-preset="compact">Compact</button>
          <button type="button" class="mb-preset-btn" data-preset="specials">Specials</button>
        </div>
        <p class="mb-field-hint">Presets adjust sizes only — you can still fine-tune every control.</p>
      </div>
      <div class="field"><label>Menu Type</label>
        <select id="mb-type">
          <option value="full" ${this.draft.menuType === 'full' ? 'selected' : ''}>Full Menu</option>
          <option value="specials" ${this.draft.menuType === 'specials' ? 'selected' : ''}>Specials</option>
          <option value="takeaway" ${this.draft.menuType === 'takeaway' ? 'selected' : ''}>Takeaway</option>
          <option value="buyget" ${this.draft.menuType === 'buyget' ? 'selected' : ''}>Buy X Get Free</option>
        </select>
        <p class="mb-field-hint">Buy X Get Free uses product boxes with arrows — set offers on the Buy &amp; Free tab.</p>
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
      <div class="field"><label>Products per page</label>
        <select id="mb-grid-mode">
          <option value="auto" ${this.draft.gridMode !== 'custom' ? 'selected' : ''}>Auto (by page size)</option>
          <option value="custom" ${this.draft.gridMode === 'custom' ? 'selected' : ''}>Custom grid</option>
        </select>
        <div class="mb-grid-custom" id="mb-grid-custom" style="${this.draft.gridMode === 'custom' ? '' : 'display:none'}">
          <label>Across (columns)
            <input type="number" id="mb-cols" min="1" max="6" value="${Number(this.draft.gridCols) || 2}">
          </label>
          <label>Down (rows)
            <input type="number" id="mb-rows" min="1" max="8" value="${Number(this.draft.gridRows) || 4}">
          </label>
        </div>
      </div>
      <div class="field"><label>Theme / Colour</label>
        <div class="mb-swatches" id="mb-swatches">
          ${Object.keys(this.THEMES).map((k) =>
            `<button type="button" class="mb-swatch ${this.draft.theme === k ? 'active' : ''}" data-theme="${k}" style="background:${this.THEMES[k].accent}" title="${k}"></button>`
          ).join('')}
        </div>
      </div>
      <div class="field"><label>Custom Title</label>
        <input type="text" id="mb-title" value="${this.esc(this.draft.customTitle)}">
      </div>`;
  },

  applyPreset(name) {
    const p = this.PRESETS[name];
    if (!p) return;
    this.readDraftFromDom();
    Object.assign(this.draft, p);
    if (name === 'specials') this.draft.menuType = 'specials';
    this.toast(`Applied ${name} look — fine-tune anytime`, 'success');
    this.paintBuilder();
  },

  readDraftFromDom() {
    const setIf = (id, fn) => {
      const el = document.getElementById(id);
      if (el) fn(el);
    };
    setIf('mb-type', (el) => { this.draft.menuType = el.value || 'full'; });
    setIf('mb-size', (el) => { this.draft.pageSize = el.value || 'A4'; });
    const ori = document.querySelector('input[name="mb-ori"]:checked');
    if (ori) this.draft.orientation = ori.value || 'portrait';
    setIf('mb-grid-mode', (el) => { this.draft.gridMode = el.value || 'auto'; });
    setIf('mb-cols', (el) => {
      this.draft.gridCols = Math.max(1, Math.min(6, Number(el.value) || 2));
    });
    setIf('mb-rows', (el) => {
      this.draft.gridRows = Math.max(1, Math.min(8, Number(el.value) || 4));
    });
    const toggleMap = [
      ['mb-inc-logo', 'includeLogo'],
      ['mb-inc-slogan', 'includeSlogan'],
      ['mb-inc-branch', 'includeBranch'],
      ['mb-inc-phone', 'includePhone'],
      ['mb-inc-date', 'includeDate'],
      ['mb-inc-footer', 'includeFooter'],
      ['mb-inc-order', 'includeOrderLink'],
      ['mb-inc-qr', 'includeQr'],
      ['mb-inc-socials', 'includeSocials'],
      ['mb-center-single', 'centerSingle'],
      ['mb-text-bg', 'textBackground']
    ];
    toggleMap.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) this.draft[key] = !!el.checked;
    });
    setIf('mb-lang', (el) => { this.draft.menuLanguage = el.value || 'en'; });
    setIf('mb-social-fb', (el) => { this.draft.socialFacebook = el.value || ''; });
    setIf('mb-social-ig', (el) => { this.draft.socialInstagram = el.value || ''; });
    setIf('mb-social-tt', (el) => { this.draft.socialTiktok = el.value || ''; });
    setIf('mb-social-wa', (el) => { this.draft.socialWhatsapp = el.value || ''; });
    setIf('mb-social-web', (el) => { this.draft.socialWebsite = el.value || ''; });
    setIf('mb-name-color', (el) => { this.draft.nameColor = el.value || ''; });
    setIf('mb-price-color', (el) => { this.draft.priceColor = el.value || ''; });
    const logoShape = document.querySelector('input[name="mb-logo-shape"]:checked');
    if (logoShape) {
      this.draft.logoShape = logoShape.value === 'square' ? 'square' : 'circle';
    }
    const prodShape = document.querySelector('input[name="mb-prod-shape"]:checked');
    if (prodShape) {
      this.draft.productImageShape = prodShape.value === 'square' ? 'square' : 'circle';
    }
    const scaleOf = (id, min, max, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      this.draft[key] = Math.max(min, Math.min(max, (Number(el.value) || 100) / 100));
    };
    scaleOf('mb-info-font', 0.7, 2.2, 'infoFontScale');
    scaleOf('mb-img-scale', 0.25, 2.8, 'imageScale');
    scaleOf('mb-shop-name', 0.7, 2, 'shopNameScale');
    scaleOf('mb-slogan-scale', 0.6, 2, 'sloganScale');
    scaleOf('mb-order-font', 0.7, 2, 'orderFontScale');
    scaleOf('mb-delivery-scale', 0.7, 2, 'deliveryScale');
    scaleOf('mb-item-name', 0.5, 2.5, 'itemNameScale');
    scaleOf('mb-price-scale', 0.5, 2.5, 'priceScale');
    scaleOf('mb-text-pad', 0.5, 1.8, 'textPadding');
    scaleOf('mb-qr-scale', 0.6, 1.8, 'qrScale');
    scaleOf('mb-date-scale', 0.7, 2.2, 'dateScale');
    // Buy & Free block settings
    if (!this.draft.buyGetBlock || typeof this.draft.buyGetBlock !== 'object') {
      this.draft.buyGetBlock = {
        size: 'medium', layout: 'auto', customWidthPct: 92, customHeightPct: 55,
        spacing: 1, padding: 1, align: 'center', imageShape: 'circle',
        imageScale: 1, textScale: 1, priceScale: 1, title: 'BUY X GET X FREE'
      };
    }
    const bg = this.draft.buyGetBlock;
    setIf('mb-bg-title', (el) => { bg.title = el.value || 'BUY X GET X FREE'; });
    const bgShape = document.querySelector('input[name="mb-bg-shape"]:checked');
    if (bgShape) bg.imageShape = bgShape.value || 'circle';
    const bgScale = (id, min, max, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      bg[key] = Math.max(min, Math.min(max, (Number(el.value) || 100) / 100));
    };
    bgScale('mb-bg-img', 0.5, 1.6, 'imageScale');
    bgScale('mb-bg-text', 0.6, 1.8, 'textScale');
    bgScale('mb-bg-price', 0.6, 1.8, 'priceScale');
    bgScale('mb-bg-spacing', 0.4, 2, 'spacing');
    bgScale('mb-bg-padding', 0.4, 2, 'padding');
    setIf('mb-bg-w', (el) => { bg.customWidthPct = Math.max(40, Math.min(100, Number(el.value) || 92)); });
    setIf('mb-bg-h', (el) => { bg.customHeightPct = Math.max(25, Math.min(95, Number(el.value) || 55)); });
    if (this.draft.buyGetAlign) bg.align = this.draft.buyGetAlign;
    setIf('mb-title', (el) => { this.draft.customTitle = el.value || 'Our Menu'; });
    setIf('mb-footer', (el) => { this.draft.footerText = el.value || ''; });
    setIf('mb-delivery', (el) => {
      this.draft.deliveryText = el.value || 'FREE DELIVERY for orders R50+';
    });
    if (!this.draft.priceOverrides || typeof this.draft.priceOverrides !== 'object') {
      this.draft.priceOverrides = {};
    }
    document.querySelectorAll('.mb-price-input[data-price-pid]').forEach((inp) => {
      const id = Number(inp.dataset.pricePid);
      if (!id) return;
      const n = Number(inp.value);
      if (inp.value === '' || Number.isNaN(n)) delete this.draft.priceOverrides[id];
      else this.draft.priceOverrides[id] = n;
    });
  },

  bindProductChecks() {
    this.el?.querySelectorAll('#mb-prod-list input[data-pid]').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const id = Number(inp.dataset.pid);
        const offerMode = this.draft.menuType === 'buyget' || this.settingsTab === 'offers';
        if (offerMode) {
          e.preventDefault();
          this.toggleOfferProduct(id);
          inp.checked = this.selectedIds.has(id);
          return;
        }
        if (inp.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        inp.closest('.mb-prod-row')?.classList.toggle('is-on', inp.checked);
        const count = document.getElementById('mb-sel-count');
        if (count) count.textContent = `${this.selectedIds.size} selected`;
        const priceBox = document.getElementById('mb-price-overrides');
        if (priceBox) {
          this.readDraftFromDom();
          priceBox.innerHTML = this.priceOverridesHtml();
          this.bindPriceInputs();
        }
      });
      // Also catch click on row for buy/free assign
      const row = inp.closest('.mb-prod-row');
      row?.addEventListener('click', (ev) => {
        if (this.draft.menuType !== 'buyget' && this.settingsTab !== 'offers') return;
        if (ev.target === inp) return;
        ev.preventDefault();
        const id = Number(inp.dataset.pid);
        this.toggleOfferProduct(id);
      });
    });
  },

  toggleOfferProduct(id) {
    if (!Array.isArray(this.draft.buyGetOffers) || !this.draft.buyGetOffers.length) {
      this.draft.buyGetOffers = [{ buyIds: [], freeIds: [], freeImageDataUrl: '' }];
    }
    const oi = Math.min(this.activeOfferIndex || 0, this.draft.buyGetOffers.length - 1);
    const offer = this.draft.buyGetOffers[oi];
    const mode = this.offerPickMode || 'buy';
    const key = mode === 'free' ? 'freeIds' : 'buyIds';
    const other = mode === 'free' ? 'buyIds' : 'freeIds';
    const list = (offer[key] || []).map(Number);
    const idx = list.indexOf(Number(id));
    if (idx >= 0) list.splice(idx, 1);
    else list.push(Number(id));
    offer[key] = list;
    // Remove from the other side if present
    offer[other] = (offer[other] || []).map(Number).filter((x) => x !== Number(id));
    this.selectedIds.add(Number(id));
    this.refreshProductList();
    if (this.settingsTab === 'offers') {
      const pane = document.getElementById('mb-settings-pane');
      if (pane) {
        // refresh chips without full rebuild if possible
        this.paintBuilder();
      }
    }
  },

  bindPriceInputs() {
    this.el?.querySelectorAll('.mb-price-input[data-price-pid]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = Number(inp.dataset.pricePid);
        if (!id) return;
        if (!this.draft.priceOverrides) this.draft.priceOverrides = {};
        const n = Number(inp.value);
        if (inp.value === '' || Number.isNaN(n)) delete this.draft.priceOverrides[id];
        else this.draft.priceOverrides[id] = n;
        this.refreshProductList();
      });
    });
  },

  bindBuilder() {
    this.el?.querySelectorAll('[data-mb-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.mbTab;
        if (!tab || tab === this.settingsTab) return;
        this.readDraftFromDom();
        this.settingsTab = tab;
        this.paintBuilder();
      });
    });
    document.getElementById('mb-presets')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      this.applyPreset(btn.dataset.preset);
    });
    this.el?.querySelectorAll('[data-align-name]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.alignName;
        const val = btn.dataset.align;
        if (!key || !val) return;
        this.readDraftFromDom();
        this.draft[key] = val;
        if (key === 'buyGetAlign') {
          if (!this.draft.buyGetBlock) this.draft.buyGetBlock = {};
          this.draft.buyGetBlock.align = val;
        }
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('[data-pos-name][data-pos]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.posName;
        const val = btn.dataset.pos;
        if (!key || !val) return;
        this.readDraftFromDom();
        this.draft[key] = val;
        // Shared pad: sync independent if they were following shared
        if (key === 'textPosition') {
          if (!this.draft.namePosition) this.draft.namePosition = val;
          if (!this.draft.pricePosition) this.draft.pricePosition = val;
        }
        this.paintBuilder();
      });
    });
    ['mb-name-color', 'mb-price-color'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        this.readDraftFromDom();
        this.paintBuilder();
      });
    });
    document.getElementById('mb-text-bg')?.addEventListener('change', () => {
      this.readDraftFromDom();
      this.paintBuilder();
    });
    document.getElementById('mb-offer-add')?.addEventListener('click', () => {
      this.readDraftFromDom();
      if (!Array.isArray(this.draft.buyGetOffers)) this.draft.buyGetOffers = [];
      this.draft.buyGetOffers.push({ buyIds: [], freeIds: [], freeImageDataUrl: '' });
      this.activeOfferIndex = this.draft.buyGetOffers.length - 1;
      this.settingsTab = 'offers';
      this.paintBuilder();
    });
    this.el?.querySelectorAll('[data-offer-active]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.readDraftFromDom();
        this.activeOfferIndex = Number(btn.dataset.offerActive) || 0;
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('[data-offer-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.offerPickMode = btn.dataset.offerMode === 'free' ? 'free' : 'buy';
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('[data-offer-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.readDraftFromDom();
        this.offerSubTab = btn.dataset.offerSub || 'content';
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('[data-bg-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.readDraftFromDom();
        if (!this.draft.buyGetBlock) this.draft.buyGetBlock = {};
        this.draft.buyGetBlock.size = btn.dataset.bgSize || 'medium';
        this.offerSubTab = 'size';
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('[data-bg-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.readDraftFromDom();
        if (!this.draft.buyGetBlock) this.draft.buyGetBlock = {};
        this.draft.buyGetBlock.layout = btn.dataset.bgLayout || 'auto';
        this.offerSubTab = 'size';
        this.paintBuilder();
      });
    });
    document.getElementById('mb-bg-apply')?.addEventListener('click', () => {
      this.readDraftFromDom();
      if (this.draft.buyGetAlign) {
        if (!this.draft.buyGetBlock) this.draft.buyGetBlock = {};
        this.draft.buyGetBlock.align = this.draft.buyGetAlign;
      }
      this.draft.menuType = 'buyget';
      this.toast('Applying Buy & Free block…', 'info');
      this.generate();
    });
    const syncBgPct = (id, valId, key) => {
      const el = document.getElementById(id);
      const val = document.getElementById(valId);
      if (!el) return;
      const sync = () => {
        if (!this.draft.buyGetBlock) this.draft.buyGetBlock = {};
        this.draft.buyGetBlock[key] = Number(el.value) || 50;
        if (val) val.textContent = `${el.value}%`;
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    };
    syncBgPct('mb-bg-w', 'mb-bg-w-val', 'customWidthPct');
    syncBgPct('mb-bg-h', 'mb-bg-h-val', 'customHeightPct');
    [['mb-bg-img', 'imageScale'], ['mb-bg-text', 'textScale'], ['mb-bg-price', 'priceScale'],
      ['mb-bg-spacing', 'spacing'], ['mb-bg-padding', 'padding']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      const val = document.getElementById(`${id}-val`);
      if (!el) return;
      const sync = () => {
        const pct = Number(el.value) || 100;
        if (val) val.textContent = `${pct}%`;
        if (!this.draft.buyGetBlock) this.draft.buyGetBlock = {};
        this.draft.buyGetBlock[key] = pct / 100;
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    this.el?.querySelectorAll('[data-chip-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const side = btn.dataset.chipRemove;
        const id = Number(btn.dataset.pid);
        const oi = this.activeOfferIndex || 0;
        const offer = this.draft.buyGetOffers?.[oi];
        if (!offer) return;
        const key = side === 'free' ? 'freeIds' : 'buyIds';
        offer[key] = (offer[key] || []).map(Number).filter((x) => x !== id);
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('[data-offer-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.offerRemove);
        this.readDraftFromDom();
        if ((this.draft.buyGetOffers || []).length <= 1) return;
        this.draft.buyGetOffers.splice(i, 1);
        this.activeOfferIndex = Math.max(0, i - 1);
        this.paintBuilder();
      });
    });
    this.el?.querySelectorAll('.mb-offer-free-img').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const i = Number(inp.dataset.offerI);
        const file = e.target.files?.[0];
        if (!file || Number.isNaN(i)) return;
        this.readDraftFromDom();
        const reader = new FileReader();
        reader.onload = () => {
          if (!this.draft.buyGetOffers[i]) this.draft.buyGetOffers[i] = { buyIds: [], freeIds: [], freeImageDataUrl: '' };
          this.draft.buyGetOffers[i].freeImageDataUrl = String(reader.result || '');
          this.toast('Free-item picture added', 'success');
          this.paintBuilder();
        };
        reader.readAsDataURL(file);
      });
    });
    this.el?.querySelectorAll('.mb-offer-free-clear').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.offerI);
        this.readDraftFromDom();
        if (this.draft.buyGetOffers?.[i]) this.draft.buyGetOffers[i].freeImageDataUrl = '';
        this.paintBuilder();
      });
    });
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
    document.getElementById('mb-type')?.addEventListener('change', (e) => {
      const v = e.target.value;
      this.draft.menuType = v;
      if (v === 'specials') this.draft.customTitle = "Today's Specials";
      else if (v === 'takeaway') this.draft.customTitle = 'Takeaway Menu';
      else if (v === 'buyget') {
        this.draft.customTitle = 'Buy X Get Free';
        this.settingsTab = 'offers';
      } else this.draft.customTitle = 'Our Menu';
      const title = document.getElementById('mb-title');
      if (title) title.value = this.draft.customTitle;
      if (v === 'buyget') this.paintBuilder();
    });
    document.getElementById('mb-grid-mode')?.addEventListener('change', (e) => {
      const custom = e.target.value === 'custom';
      this.draft.gridMode = custom ? 'custom' : 'auto';
      const box = document.getElementById('mb-grid-custom');
      if (box) box.style.display = custom ? '' : 'none';
    });
    document.getElementById('mb-banner')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.draft.headerBannerDataUrl = String(reader.result || '');
        this.headerBannerImg = null;
        this.toast('Header banner added', 'success');
        this.readDraftFromDom();
        this.paintBuilder();
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('mb-banner-clear')?.addEventListener('click', () => {
      this.draft.headerBannerDataUrl = '';
      this.headerBannerImg = null;
      this.readDraftFromDom();
      this.paintBuilder();
    });
    const bindSlider = (id, valId, key) => {
      const el = document.getElementById(id);
      const val = document.getElementById(valId);
      if (!el) return;
      const sync = () => {
        const pct = Number(el.value) || 100;
        if (val) val.textContent = `${pct}%`;
        this.draft[key] = pct / 100;
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    };
    bindSlider('mb-info-font', 'mb-info-font-val', 'infoFontScale');
    bindSlider('mb-img-scale', 'mb-img-scale-val', 'imageScale');
    bindSlider('mb-shop-name', 'mb-shop-name-val', 'shopNameScale');
    bindSlider('mb-slogan-scale', 'mb-slogan-scale-val', 'sloganScale');
    bindSlider('mb-order-font', 'mb-order-font-val', 'orderFontScale');
    bindSlider('mb-delivery-scale', 'mb-delivery-scale-val', 'deliveryScale');
    bindSlider('mb-item-name', 'mb-item-name-val', 'itemNameScale');
    bindSlider('mb-price-scale', 'mb-price-scale-val', 'priceScale');
    bindSlider('mb-text-pad', 'mb-text-pad-val', 'textPadding');
    bindSlider('mb-qr-scale', 'mb-qr-scale-val', 'qrScale');
    bindSlider('mb-date-scale', 'mb-date-scale-val', 'dateScale');
    this.bindPriceInputs();
    document.getElementById('mb-generate')?.addEventListener('click', () => this.generate());
    this.bindActions();
  },

  bindActions() {
    document.getElementById('mb-fullscreen')?.addEventListener('click', () => this.openFullscreen());
    document.getElementById('mb-pdf')?.addEventListener('click', () => this.savePdf());
    document.getElementById('mb-png')?.addEventListener('click', () => this.downloadPngPages());
    document.getElementById('mb-jpg')?.addEventListener('click', () => this.downloadJpegPages());
    document.getElementById('mb-social')?.addEventListener('click', () => this.downloadSocialVersion());
    document.getElementById('mb-print')?.addEventListener('click', () => this.printMenu());
    document.getElementById('mb-wa')?.addEventListener('click', () => this.shareWhatsApp(false));
    document.getElementById('mb-wa-group')?.addEventListener('click', () => this.shareWhatsApp(true));
    document.getElementById('mb-cc-share')?.addEventListener('click', () => this.sharePublishCC());
    document.getElementById('mb-create-video')?.addEventListener('click', () => this.createVideoFromMenu());
  },

  createVideoFromMenu() {
    this.readDraftFromDom();
    let productIds = [...this.selectedIds].map(Number).filter(Boolean);
    if (this.draft.menuType === 'buyget') {
      (this.draft.buyGetOffers || []).forEach((o) => {
        (o.buyIds || []).forEach((id) => productIds.push(Number(id)));
        (o.freeIds || []).forEach((id) => productIds.push(Number(id)));
      });
      productIds = [...new Set(productIds.filter(Boolean))];
    }
    if (!productIds.length) return this.toast('Select products on the menu first', 'error');
    const payload = {
      productIds,
      title: this.draft.customTitle || 'Our Menu',
      menuType: this.draft.menuType || 'full',
      theme: this.draft.theme || 'red',
      branchId: this.branchId || 'all',
      deliveryText: this.draft.deliveryText || '',
      footerText: this.draft.footerText || '',
      socialFacebook: this.draft.socialFacebook || '',
      socialInstagram: this.draft.socialInstagram || '',
      socialWhatsapp: this.draft.socialWhatsapp || '',
      socialWebsite: this.draft.socialWebsite || '',
      createdAt: Date.now()
    };
    try {
      localStorage.setItem('shoppos_video_from_menu', JSON.stringify(payload));
      sessionStorage.setItem('shoppos_video_from_menu', JSON.stringify(payload));
    } catch (_) { /* */ }
    this.toast('Opening Promo Video Builder…', 'success');
    const admin = window.AdminPage;
    if (admin && typeof admin._renderSectionCore === 'function') {
      admin.section = 'promo-video-builder';
      const content = document.getElementById('admin-content');
      if (content) {
        document.querySelectorAll('.admin-nav-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.section === 'promo-video-builder');
        });
        return admin._renderSectionCore(content);
      }
    }
    this.toast('Open Admin → Promo Video Builder — your menu selection is ready', 'info');
  },

  canvasSize() {
    const size = this.SIZES[this.draft.pageSize] || this.SIZES.A4;
    let wMm = size.w;
    let hMm = size.h;
    if (this.draft.orientation === 'landscape' && this.draft.pageSize !== 'square') {
      wMm = size.h;
      hMm = size.w;
    }
    // High print DPI (~6–8 px/mm) for crisp PDF / PNG / JPEG exports
    const scale = this.draft.pageSize === 'A1' || this.draft.pageSize === 'A2' ? 3
      : this.draft.pageSize === 'social' ? 12
      : 7;
    return { w: Math.round(wMm * scale), h: Math.round(hMm * scale), wMm, hMm };
  },

  /** Max products that fit one page for this size/orientation (pagination ceiling). */
  maxProductsPerPage() {
    if (this.draft.gridMode === 'custom') {
      return Math.max(1, Math.min(48,
        (Number(this.draft.gridCols) || 2) * (Number(this.draft.gridRows) || 4)));
    }
    const sizeKey = this.draft.pageSize;
    const land = this.draft.orientation === 'landscape' && sizeKey !== 'square';
    const type = this.draft.menuType;
    if (type === 'specials') {
      if (sizeKey === 'A5' || sizeKey === 'flyer') return 4;
      if (sizeKey === 'square' || sizeKey === 'social') return 4;
      return land ? 8 : 6;
    }
    if (type === 'takeaway') return land ? 12 : 12;
    if (sizeKey === 'social') return 6;
    if (sizeKey === 'square') return 4;
    if (sizeKey === 'flyer' || sizeKey === 'A5') return land ? 6 : 6;
    if (sizeKey === 'A4') return land ? 8 : 8;
    if (sizeKey === 'A3') return land ? 12 : 12;
    if (sizeKey === 'A2' || sizeKey === 'A1') return land ? 15 : 15;
    return land ? 8 : 8;
  },

  /**
   * True landscape/portrait grid for the items on THIS page.
   * Uses full width; never packs more than fits comfortably.
   */
  adaptiveGridForCount(count) {
    const n = Math.max(1, Number(count) || 1);
    if (this.draft.gridMode === 'custom') {
      return {
        cols: Math.max(1, Math.min(6, Number(this.draft.gridCols) || 2)),
        rows: Math.max(1, Math.min(8, Number(this.draft.gridRows) || 4))
      };
    }
    const land = this.draft.orientation === 'landscape' && this.draft.pageSize !== 'square';
    const sizeKey = this.draft.pageSize;
    const type = this.draft.menuType;

    if (type === 'specials') {
      if (n === 1) return { cols: 1, rows: 1 };
      if (n === 2) return land ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
      if (n <= 4) return { cols: 2, rows: 2 };
      if (n <= 6) return land ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
      return land ? { cols: 4, rows: 2 } : { cols: 2, rows: 3 };
    }

    if (!land) {
      // Portrait — keep existing sensible defaults by count
      if (n === 1) return { cols: 1, rows: 1 };
      if (n === 2) return { cols: 1, rows: 2 };
      if (n <= 4) return { cols: 2, rows: 2 };
      if (n <= 6) return { cols: 2, rows: 3 };
      if (n <= 8) return { cols: 2, rows: 4 };
      if (n <= 9) return { cols: 3, rows: 3 };
      if (n <= 12) return { cols: 3, rows: 4 };
      return { cols: 3, rows: 5 };
    }

    // Landscape — wide grids that use horizontal space
    if (n === 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    if (n === 3) return { cols: 3, rows: 1 };
    if (n === 4) return sizeKey === 'A5' || sizeKey === 'flyer' ? { cols: 2, rows: 2 } : { cols: 4, rows: 1 };
    if (n <= 6) return { cols: 3, rows: 2 };
    if (n <= 8) return { cols: 4, rows: 2 };
    if (n <= 9) return { cols: 3, rows: 3 };
    if (n <= 12) {
      if (sizeKey === 'A2' || sizeKey === 'A1' || sizeKey === 'A3') return { cols: 4, rows: 3 };
      return { cols: 4, rows: 3 };
    }
    if (n <= 15) return { cols: 5, rows: 3 };
    return { cols: 5, rows: 3 };
  },

  productsPerPage(itemCount) {
    if (itemCount != null) return this.adaptiveGridForCount(itemCount);
    // Fallback used by UI hints — assume a full page
    return this.adaptiveGridForCount(this.maxProductsPerPage());
  },

  /**
   * Landscape layout plan: margins → header → title → grid → footer.
   * Scales fonts/images so cards stay readable inside the printable area.
   */
  computeLandscapeLayout(W, H, itemCount, shop) {
    const n = Math.max(1, itemCount || 1);
    const margin = Math.round(Math.min(W, H) * 0.028);
    const includeFooter = this.draft.includeFooter !== false;
    const socialCount = this.socialLines().length;
    const hasQr = this.draft.includeQr !== false && !!shop?.orderUrl;

    // Footer: compact but tall enough for QR + socials + delivery
    let footerH = includeFooter
      ? Math.round(H * (hasQr || socialCount > 2 ? 0.15 : 0.12))
      : Math.round(H * 0.025);
    footerH = Math.max(Math.round(H * 0.1), Math.min(Math.round(H * 0.18), footerH));

    // Header: single horizontal brand+info band (not stacked portrait bars)
    let headerH = Math.round(H * 0.145);
    headerH = Math.max(Math.round(H * 0.12), Math.min(Math.round(H * 0.18), headerH));

    const titleH = Math.round(H * (this.draft.menuType === 'specials' || this.draft.menuType === 'buyget' ? 0.055 : 0.045));
    const gapAfterHeader = Math.round(H * 0.01);
    const gapAfterTitle = Math.round(H * 0.012);

    const contentTop = margin + headerH + gapAfterHeader + titleH + gapAfterTitle;
    const contentBottom = H - margin - footerH;
    let gridH = Math.max(80, contentBottom - contentTop);
    let gridW = W - margin * 2;

    const grid = this.adaptiveGridForCount(n);
    let cols = grid.cols;
    let rows = Math.max(grid.rows, Math.ceil(n / cols));
    // Prefer filling width: if few items, don't leave empty columns
    if (n < cols && rows === 1) cols = n;

    const gap = Math.max(8, Math.round(Math.min(gridW, gridH) * 0.016));
    let cellW = (gridW - gap * (cols - 1)) / cols;
    let cellH = (gridH - gap * (rows - 1)) / rows;

    // If cards are too short for name+price, reduce rows by paginating… but here we only layout one page.
    // Shrink image/name scales instead so everything stays inside the card.
    const minCellH = Math.round(H * 0.22);
    const minCellW = Math.round(W * 0.12);
    let imgScale = Math.max(0.25, Math.min(2.8, Number(this.draft.imageScale) || 1));
    let itemNameScale = Math.max(0.5, Math.min(2.5, Number(this.draft.itemNameScale) || 1));
    let shopNameScale = Math.max(0.7, Math.min(1.4, Number(this.draft.shopNameScale) || 1));
    let infoFontScale = Math.max(0.7, Math.min(1.3, Number(this.draft.infoFontScale) || 1));
    let orderScale = Math.max(0.7, Math.min(1.4, Number(this.draft.orderFontScale) || 1));
    let deliveryScale = Math.max(0.65, Math.min(1.2, Number(this.draft.deliveryScale) || 1));
    let qrScale = Math.max(0.55, Math.min(1.2, Number(this.draft.qrScale) || 1));
    let dateScale = Math.max(0.7, Math.min(1.6, Number(this.draft.dateScale) || 1));

    // Soft auto-fit only when user has not pushed image size hard
    const cellScore = Math.min(cellW / (W * 0.2), cellH / (H * 0.35));
    const userBoosted = imgScale > 1.4 || imgScale < 0.55;
    if (!userBoosted) {
      if (cellScore < 0.85) {
        imgScale *= 0.85;
        itemNameScale *= 0.9;
      } else if (cellScore > 1.2 && n <= 4) {
        imgScale = Math.min(1.45, imgScale * 1.12);
        itemNameScale = Math.min(1.45, itemNameScale * 1.08);
      }
    }

    // Layout safety: ensure footer doesn't collide — if grid too short, trim header/footer slightly
    let guard = 0;
    while (cellH < minCellH * 0.55 && guard < 4) {
      if (headerH > H * 0.11) headerH = Math.round(headerH * 0.92);
      if (footerH > H * 0.1) footerH = Math.round(footerH * 0.92);
      const top = margin + headerH + gapAfterHeader + titleH + gapAfterTitle;
      const bottom = H - margin - footerH;
      gridH = Math.max(60, bottom - top);
      cellH = (gridH - gap * (rows - 1)) / rows;
      cellW = (gridW - gap * (cols - 1)) / cols;
      imgScale *= 0.94;
      itemNameScale *= 0.94;
      guard += 1;
    }

    // Widen single/dual cards so they don't float as tiny islands
    let cardScale = 1;
    if (n === 1) cardScale = 0.55; // fraction of grid used (centred)
    else if (n === 2) cardScale = 0.9;
    else cardScale = 1;

    return {
      margin,
      headerH,
      titleH,
      footerH,
      gapAfterHeader,
      gapAfterTitle,
      contentTop: margin + headerH + gapAfterHeader + titleH + gapAfterTitle,
      gridW,
      gridH: Math.max(60, H - margin - footerH - (margin + headerH + gapAfterHeader + titleH + gapAfterTitle)),
      cols,
      rows,
      gap,
      cellW,
      cellH,
      cardScale,
      imgScale,
      itemNameScale,
      shopNameScale,
      infoFontScale,
      orderScale,
      deliveryScale,
      qrScale,
      dateScale,
      minCellW,
      minCellH
    };
  },

  menuTheme(base) {
    const t = { ...base };
    const type = this.draft.menuType;
    if (type === 'specials') {
      t.bannerStyle = 'specials';
      t.cardStyle = 'specials';
      t.titleFallback = "TODAY'S SPECIALS";
      t.gold = t.gold || '#fbbf24';
    } else if (type === 'buyget') {
      t.bannerStyle = 'buyget';
      t.cardStyle = 'buyget';
      t.titleFallback = 'BUY X GET FREE';
      t.gold = t.gold || '#fbbf24';
    } else if (type === 'takeaway') {
      t.bannerStyle = 'takeaway';
      t.cardStyle = 'takeaway';
      t.titleFallback = 'TAKEAWAY MENU';
    } else {
      t.bannerStyle = 'full';
      t.cardStyle = 'full';
      t.titleFallback = 'OUR MENU';
    }
    return t;
  },

  async generate() {
    this.readDraftFromDom();
    if (!this.products.length) {
      await this.loadProducts();
    }
    const isBuyGet = this.draft.menuType === 'buyget';
    const selected = this.selectedProducts();
    if (!isBuyGet && !selected.length) return this.toast('Search and mark at least one product', 'error');
    if (isBuyGet) {
      const offers = (this.draft.buyGetOffers || []).filter((o) =>
        (o.buyIds && o.buyIds.length) || (o.freeIds && o.freeIds.length) || o.freeImageDataUrl);
      if (!offers.length) {
        return this.toast('Add at least one Buy X Get Free offer on the Buy & Free tab', 'error');
      }
    }
    const btn = document.getElementById('mb-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const { w: W, h: H } = this.canvasSize();
      const shop = this.shopBlock();
      shop.orderUrl = (typeof Utils !== 'undefined' && Utils.getOnlineOrderUrl)
        ? Utils.getOnlineOrderUrl()
        : '';
      const theme = this.menuTheme(this.THEMES[this.draft.theme] || this.THEMES.red);
      const logoImg = this.draft.includeLogo
        ? await (window.PromoPoster?.loadImage?.(shop.logoUrl) || this.loadImage(shop.logoUrl))
        : null;
      let bannerImg = null;
      if (this.draft.headerBannerDataUrl) {
        bannerImg = await this.loadImage(this.draft.headerBannerDataUrl);
      }
      let qrImg = null;
      if (this.draft.includeQr !== false && shop.orderUrl) {
        qrImg = await this.loadQrImage(shop.orderUrl);
      }

      const pages = [];
      if (isBuyGet) {
        const offers = (this.draft.buyGetOffers || []).filter((o) =>
          (o.buyIds && o.buyIds.length) || (o.freeIds && o.freeIds.length) || o.freeImageDataUrl);
        const resolved = [];
        for (const offer of offers) {
          const buySlots = [];
          for (const id of (offer.buyIds || [])) {
            const p = this.products.find((x) => Number(x.id) === Number(id));
            if (!p) continue;
            buySlots.push({
              product: p,
              img: await (window.PromoPoster?.loadImage?.(this.productImageUrl(p)) || this.loadImage(this.productImageUrl(p)))
            });
          }
          const freeSlots = [];
          for (const id of (offer.freeIds || [])) {
            const p = this.products.find((x) => Number(x.id) === Number(id));
            if (!p) continue;
            freeSlots.push({
              product: p,
              img: await (window.PromoPoster?.loadImage?.(this.productImageUrl(p)) || this.loadImage(this.productImageUrl(p)))
            });
          }
          let freeCustomImg = null;
          if (offer.freeImageDataUrl) freeCustomImg = await this.loadImage(offer.freeImageDataUrl);
          if (!buySlots.length && !freeSlots.length && !freeCustomImg) continue;
          resolved.push({ buySlots, freeSlots, freeCustomImg });
        }
        if (!resolved.length) throw new Error('Could not load Buy X Get Free products');
        resolved.forEach((o) => o.buySlots.forEach((s) => this.selectedIds.add(Number(s.product.id))));
        const canvas = this.renderPage({
          W, H, theme, shop, logoImg, bannerImg, qrImg, items: [], grid: { cols: 1, rows: 1 },
          pageIndex: 0, pageCount: 1, buyGetOffers: resolved
        });
        pages.push({ canvas, dataUrl: canvas.toDataURL('image/png') });
      } else {
        const maxPer = this.maxProductsPerPage();
        const chunks = [];
        for (let i = 0; i < selected.length; i += maxPer) {
          chunks.push(selected.slice(i, i + maxPer));
        }
        for (let pi = 0; pi < chunks.length; pi++) {
          const chunk = chunks[pi];
          const grid = this.adaptiveGridForCount(chunk.length);
          const imgs = await Promise.all(chunk.map(async (p) => ({
            product: p,
            img: await (window.PromoPoster?.loadImage?.(this.productImageUrl(p)) || this.loadImage(this.productImageUrl(p)))
          })));
          const canvas = this.renderPage({
            W, H, theme, shop, logoImg, bannerImg, qrImg, items: imgs, grid,
            pageIndex: pi, pageCount: chunks.length
          });
          pages.push({ canvas, dataUrl: canvas.toDataURL('image/png') });
        }
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

  loadQrImage(data) {
    if (!data) return Promise.resolve(null);
    const src = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=10&data=${encodeURIComponent(String(data))}`;
    return this.loadImage(src);
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

  /** Fit whole image inside box (no aggressive crop) — preferred for menu cards. */
  drawContain(ctx, img, x, y, w, h) {
    if (!img) return;
    const ir = img.width / img.height;
    const dr = w / h;
    let dw = w;
    let dh = h;
    let dx = x;
    let dy = y;
    if (ir > dr) {
      dw = w;
      dh = w / ir;
      dy = y + (h - dh) / 2;
    } else {
      dh = h;
      dw = h * ir;
      dx = x + (w - dw) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  },

  drawIconPin(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.15, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.32, y - s * 0.05);
    ctx.lineTo(x, y + s * 0.45);
    ctx.lineTo(x + s * 0.32, y - s * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.18, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
  },

  drawIconPhone(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    this.roundRect(ctx, x - s * 0.28, y - s * 0.42, s * 0.56, s * 0.84, s * 0.12);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this.roundRect(ctx, x - s * 0.18, y - s * 0.28, s * 0.36, s * 0.48, 2);
    ctx.fill();
  },

  drawIconClock(ctx, x, y, s, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, s * 0.1);
    ctx.beginPath();
    ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - s * 0.22);
    ctx.moveTo(x, y);
    ctx.lineTo(x + s * 0.18, y + s * 0.08);
    ctx.stroke();
  },

  renderPage({ W, H, theme, shop, logoImg, bannerImg, qrImg, items, grid, pageIndex, pageCount, buyGetOffers }) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const t = theme;
    const type = this.draft.menuType;
    const isLandscape = W > H;

    // Background
    if (type === 'specials' || type === 'buyget') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1a0a0a');
      g.addColorStop(0.45, t.bg);
      g.addColorStop(1, '#0f172a');
      ctx.fillStyle = g;
    } else if (type === 'takeaway') {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let i = 0; i < 12; i++) ctx.fillRect(0, i * (H / 12), W, 2);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, t.bg);
      g.addColorStop(0.5, t.card);
      g.addColorStop(1, t.bg);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, W, H);

    if (isLandscape) {
      return this.renderLandscapePage({
        canvas, ctx, W, H, theme, shop, logoImg, bannerImg, qrImg,
        items, grid, pageIndex, pageCount, buyGetOffers
      });
    }

    return this.renderPortraitPage({
      canvas, ctx, W, H, theme, shop, logoImg, bannerImg, qrImg,
      items, grid, pageIndex, pageCount, buyGetOffers
    });
  },

  renderLandscapePage({ canvas, ctx, W, H, theme, shop, logoImg, bannerImg, qrImg, items, grid, pageIndex, pageCount, buyGetOffers }) {
    const t = theme;
    const type = this.draft.menuType;
    const itemCount = (type === 'buyget' && buyGetOffers?.length)
      ? buyGetOffers.length
      : Math.max(1, items.length);
    const layout = this.computeLandscapeLayout(W, H, itemCount, shop);
    const {
      margin: pad, headerH, titleH, footerH, gapAfterHeader, gapAfterTitle,
      cols, rows, gap, imgScale, itemNameScale, shopNameScale, infoFontScale,
      orderScale, deliveryScale, qrScale, dateScale
    } = layout;
    let { gridH, cellW, cellH } = layout;
    const prodShape = this.draft.productImageShape === 'square' ? 'square' : 'circle';
    const logoShape = this.draft.logoShape === 'square' ? 'square' : 'circle';
    const showSlogan = this.draft.includeSlogan !== false;
    const slogan = this.draft.footerText || 'Thank you for your purchase!';
    const hoursLabel = shop.hours || `${this.L('openDailyFrom')} 7 AM ${this.L('to')} 9 PM`;
    const locText = (this.draft.includeBranch && (shop.address || shop.branchName))
      ? String(shop.address || shop.branchName) : '';
    const branchText = (this.draft.includeBranch && shop.branchName) ? String(shop.branchName) : '';
    const phoneText = (this.draft.includePhone && shop.phone) ? String(shop.phone) : '';

    // Optional banner behind header only
    if (bannerImg) {
      ctx.save();
      this.roundRect(ctx, pad, pad, W - pad * 2, headerH, 12);
      ctx.clip();
      this.drawCover(ctx, bannerImg, pad, pad, W - pad * 2, headerH);
      const shade = ctx.createLinearGradient(0, pad, 0, pad + headerH);
      shade.addColorStop(0, 'rgba(15,23,42,0.4)');
      shade.addColorStop(1, 'rgba(15,23,42,0.7)');
      ctx.fillStyle = shade;
      ctx.fillRect(pad, pad, W - pad * 2, headerH);
      ctx.restore();
    }

    // ——— Horizontal header: logo | name/slogan/branch | red info strip ———
    const logoSize = Math.round(headerH * 0.78);
    let x = pad + 8;
    const headerMidY = pad + headerH / 2;
    if (logoImg && this.draft.includeLogo) {
      const ly = pad + (headerH - logoSize) / 2;
      ctx.save();
      if (logoShape === 'circle') {
        ctx.beginPath();
        ctx.arc(x + logoSize / 2, ly + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
      } else {
        this.roundRect(ctx, x, ly, logoSize, logoSize, 10);
        ctx.clip();
      }
      this.drawCover(ctx, logoImg, x, ly, logoSize, logoSize);
      ctx.restore();
      if (logoShape === 'circle') {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(2, W * 0.0025);
        ctx.beginPath();
        ctx.arc(x + logoSize / 2, ly + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      x += logoSize + Math.round(W * 0.014);
    }

    const infoStripW = Math.round(W * 0.42);
    const nameMaxW = W - pad - 12 - infoStripW - x - 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.text;
    const nameFont = Math.round(H * 0.045 * shopNameScale);
    ctx.font = `bold ${nameFont}px system-ui,Segoe UI,sans-serif`;
    let shopLabel = String(shop.shopName || 'Shop');
    while (shopLabel.length > 4 && ctx.measureText(shopLabel).width > nameMaxW) {
      shopLabel = shopLabel.slice(0, -2);
    }
    if (shopLabel !== shop.shopName) shopLabel += '…';
    const nameY = showSlogan || branchText
      ? headerMidY - Math.round(headerH * 0.18)
      : headerMidY;
    ctx.fillText(shopLabel, x, nameY);

    let subY = nameY + Math.round(nameFont * 0.95);
    if (branchText && branchText !== locText) {
      ctx.fillStyle = t.muted;
      ctx.font = `600 ${Math.round(H * 0.022)}px system-ui,Segoe UI,sans-serif`;
      let b = branchText;
      while (b.length > 4 && ctx.measureText(b).width > nameMaxW) b = b.slice(0, -2);
      if (b !== branchText) b += '…';
      ctx.fillText(b, x, subY);
      subY += Math.round(H * 0.028);
    }
    if (showSlogan) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.round(H * 0.02 * (Number(this.draft.sloganScale) || 1))}px system-ui,Segoe UI,sans-serif`;
      let s = slogan;
      while (s.length > 4 && ctx.measureText(s).width > nameMaxW) s = s.slice(0, -2);
      if (s !== slogan) s += '…';
      ctx.fillText(s, x, subY);
    }

    // Right-side contact strip (horizontal info — uses landscape width)
    const stripX = W - pad - infoStripW;
    const stripY = pad + Math.round(headerH * 0.12);
    const stripH = headerH - Math.round(headerH * 0.24);
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, stripX, stripY, infoStripW, stripH, 10);
    ctx.fill();
    const infoFont = Math.round(H * 0.022 * infoFontScale);
    const lineH = Math.round(infoFont * 1.35);
    const iconS = Math.round(infoFont * 1.15);
    const infoLines = [];
    if (locText) infoLines.push({ icon: 'pin', text: locText });
    if (phoneText) infoLines.push({ icon: 'phone', text: phoneText });
    infoLines.push({ icon: 'clock', text: hoursLabel });
    const maxInfoLines = Math.min(3, infoLines.length);
    const blockStartY = stripY + stripH / 2 - ((maxInfoLines - 1) * lineH) / 2;
    ctx.font = `600 ${infoFont}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    infoLines.slice(0, maxInfoLines).forEach((row, i) => {
      const iy = blockStartY + i * lineH;
      const ix = stripX + 14;
      if (row.icon === 'pin') this.drawIconPin(ctx, ix + iconS * 0.35, iy, iconS, '#fff');
      else if (row.icon === 'phone') this.drawIconPhone(ctx, ix + iconS * 0.3, iy, iconS, '#fff');
      else this.drawIconClock(ctx, ix + iconS * 0.35, iy, iconS, '#fff');
      ctx.fillStyle = '#fff';
      let txt = row.text;
      const maxTw = infoStripW - iconS - 28;
      while (txt.length > 4 && ctx.measureText(txt).width > maxTw) txt = txt.slice(0, -2);
      if (txt !== row.text) txt += '…';
      ctx.fillText(txt, ix + iconS + 10, iy);
    });

    // Title banner — full width, compact
    let y = pad + headerH + gapAfterHeader;
    const title = String(this.draft.customTitle || t.titleFallback || 'OUR MENU').toUpperCase();
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, pad, y, W - pad * 2, titleH, 8);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (type === 'specials' || type === 'buyget') {
      ctx.fillStyle = t.gold || '#fbbf24';
      ctx.font = `bold ${Math.round(H * 0.018)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(type === 'buyget' ? this.L('buyGetBanner') : this.L('specialOffer'), W / 2, y + titleH * 0.32);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(H * 0.032)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(title, W / 2, y + titleH * 0.68);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(H * 0.034)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(title, W / 2, y + titleH / 2);
    }

    y += titleH + gapAfterTitle;
    gridH = Math.max(60, H - pad - footerH - y);

    // Product / offer area — fills remaining width & height
    if (type === 'buyget' && Array.isArray(buyGetOffers) && buyGetOffers.length) {
      this.paintBuyGetOffers(ctx, buyGetOffers, pad, y, W - pad * 2, gridH, t, imgScale, itemNameScale, prodShape);
    } else {
      const useCols = Math.min(cols, Math.max(1, items.length));
      const useRows = Math.max(1, Math.ceil(items.length / useCols));
      cellW = (W - pad * 2 - gap * (useCols - 1)) / useCols;
      cellH = (gridH - gap * (useRows - 1)) / useRows;

      // Centre sparse last rows / few items
      const centerSingle = this.draft.centerSingle !== false && items.length === 1;
      if (centerSingle && items[0]) {
        const cw = Math.min(W - pad * 2, Math.max(cellW, gridH * 0.85));
        const ch = Math.min(gridH, cw * 1.05);
        const cx = pad + (W - pad * 2 - cw) / 2;
        const cy = y + (gridH - ch) / 2;
        this.paintProductCard(ctx, items[0], cx, cy, cw, ch, t, shop.currency, imgScale, itemNameScale, prodShape, { fit: 'contain' });
      } else {
        const totalW = useCols * cellW + (useCols - 1) * gap;
        const totalH = useRows * cellH + (useRows - 1) * gap;
        const ox = pad + Math.max(0, (W - pad * 2 - totalW) / 2);
        const oy = y + Math.max(0, (gridH - totalH) / 2);
        items.forEach((slot, i) => {
          const col = i % useCols;
          const row = Math.floor(i / useCols);
          if (row >= useRows) return;
          const cx = ox + col * (cellW + gap);
          const cy = oy + row * (cellH + gap);
          this.paintProductCard(ctx, slot, cx, cy, cellW, cellH, t, shop.currency, imgScale, itemNameScale, prodShape, { fit: 'contain' });
        });
      }
    }

    // Footer — reserved band, never overlaps products
    if (this.draft.includeFooter) {
      this.paintMenuFooter(ctx, {
        W, H, pad, t, shop, qrImg,
        isLandscape: true,
        orderScale, deliveryScale, qrScale, dateScale,
        pageIndex, pageCount,
        footerHOverride: footerH
      });
    } else if (pageCount > 1) {
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(H * 0.018)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${pageIndex + 1} / ${pageCount}`, W - pad, H - pad / 2);
    }

    return canvas;
  },

  renderPortraitPage({ canvas, ctx, W, H, theme, shop, logoImg, bannerImg, qrImg, items, grid, pageIndex, pageCount, buyGetOffers }) {
    const t = theme;
    const pad = Math.round(W * 0.032);
    const type = this.draft.menuType;
    const isLandscape = false;
    const infoScale = Math.max(0.7, Math.min(2.2, Number(this.draft.infoFontScale) || 1));
    const imgScale = Math.max(0.25, Math.min(2.8, Number(this.draft.imageScale) || 1));
    const nameScale = Math.max(0.7, Math.min(2, Number(this.draft.shopNameScale) || 1));
    const sloganScale = Math.max(0.6, Math.min(2, Number(this.draft.sloganScale) || 1));
    const orderScale = Math.max(0.7, Math.min(2, Number(this.draft.orderFontScale) || 1));
    const deliveryScale = Math.max(0.7, Math.min(2, Number(this.draft.deliveryScale) || 1));
    const itemNameScale = Math.max(0.7, Math.min(2, Number(this.draft.itemNameScale) || 1));
    const qrScale = Math.max(0.6, Math.min(1.8, Number(this.draft.qrScale) || 1));
    const dateScale = Math.max(0.7, Math.min(2.2, Number(this.draft.dateScale) || 1));
    const centerSingle = this.draft.centerSingle !== false && items.length === 1;
    const logoShape = this.draft.logoShape === 'square' ? 'square' : 'circle';
    const prodShape = this.draft.productImageShape === 'square' ? 'square' : 'circle';
    const headerAlign = this.draft.headerAlign === 'center' || this.draft.headerAlign === 'right'
      ? this.draft.headerAlign : 'left';
    const showSlogan = this.draft.includeSlogan !== false;

    let y = pad;
    const headerH = Math.round(H * 0.1);
    const infoFont = Math.round(W * 0.014 * infoScale);
    const hoursLabel = shop.hours || `${this.L('openDailyFrom')} 7 AM ${this.L('to')} 9 PM`;
    const locText = (this.draft.includeBranch && (shop.address || shop.branchName))
      ? String(shop.address || shop.branchName) : '';
    const phoneText = (this.draft.includePhone && shop.phone) ? String(shop.phone) : '';

    ctx.font = `600 ${infoFont}px system-ui,Segoe UI,sans-serif`;
    const barInnerW = W - pad * 2 - 28;
    const wrapLines = (text, maxW) => {
      const words = String(text || '').split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const lines = [];
      let cur = '';
      words.forEach((w) => {
        const test = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(test).width > maxW && cur) {
          lines.push(cur);
          cur = w;
        } else cur = test;
      });
      if (cur) lines.push(cur);
      return lines;
    };
    const colW = Math.floor(barInnerW / (locText && phoneText ? 3 : (locText || phoneText ? 2 : 1)));
    const locLines = locText ? wrapLines(locText, Math.max(80, colW - 28)) : [];
    const hoursLines = wrapLines(hoursLabel, Math.max(80, colW - 28));
    const infoLines = Math.max(1, locLines.length, phoneText ? 1 : 0, hoursLines.length);
    const barH = Math.max(
      Math.round(H * 0.048),
      Math.round(infoFont * 1.35 * infoLines + H * 0.022)
    );
    const headerBandH = headerH + Math.round(H * 0.01) + barH;

    if (bannerImg) {
      ctx.save();
      this.roundRect(ctx, pad, y, W - pad * 2, headerBandH, 14);
      ctx.clip();
      this.drawCover(ctx, bannerImg, pad, y, W - pad * 2, headerBandH);
      const shade = ctx.createLinearGradient(0, y, 0, y + headerBandH);
      shade.addColorStop(0, 'rgba(15,23,42,0.45)');
      shade.addColorStop(0.55, 'rgba(15,23,42,0.55)');
      shade.addColorStop(1, 'rgba(15,23,42,0.72)');
      ctx.fillStyle = shade;
      ctx.fillRect(pad, y, W - pad * 2, headerBandH);
      ctx.restore();
    }

    const lh = Math.round(headerH * 0.82);
    const lw = lh;
    let logoBlockW = 0;
    if (logoImg && this.draft.includeLogo) logoBlockW = lw + Math.round(W * 0.02);
    ctx.font = `bold ${Math.round(W * 0.032 * nameScale)}px system-ui,Segoe UI,sans-serif`;
    const nameW = ctx.measureText(shop.shopName).width;
    const slogan = this.draft.footerText || 'Thank you for your purchase!';
    ctx.font = `${Math.round(W * 0.016 * sloganScale)}px system-ui,Segoe UI,sans-serif`;
    const sloganW = showSlogan ? ctx.measureText(slogan).width : 0;
    const textBlockW = Math.max(nameW, sloganW);
    const totalHeaderW = logoBlockW + textBlockW;
    let headerStartX = pad + 8;
    if (headerAlign === 'center') headerStartX = Math.round((W - totalHeaderW) / 2);
    else if (headerAlign === 'right') headerStartX = W - pad - 8 - totalHeaderW;

    if (logoImg && this.draft.includeLogo) {
      const lx = headerStartX;
      const ly = y + Math.round((headerH - lh) / 2);
      ctx.save();
      if (logoShape === 'circle') {
        ctx.beginPath();
        ctx.arc(lx + lw / 2, ly + lh / 2, Math.min(lw, lh) / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
      } else {
        this.roundRect(ctx, lx, ly, lw, lh, 10);
        ctx.clip();
      }
      this.drawCover(ctx, logoImg, lx, ly, lw, lh);
      ctx.restore();
      if (logoShape === 'circle') {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(2, W * 0.003);
        ctx.beginPath();
        ctx.arc(lx + lw / 2, ly + lh / 2, Math.min(lw, lh) / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const textX = headerStartX + logoBlockW;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.text;
    ctx.font = `bold ${Math.round(W * 0.032 * nameScale)}px system-ui,Segoe UI,sans-serif`;
    const nameY = showSlogan ? y + headerH / 2 - Math.round(H * 0.014) : y + headerH / 2;
    ctx.fillText(shop.shopName, textX, nameY);
    if (showSlogan) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.round(W * 0.016 * sloganScale)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(slogan, textX, y + headerH / 2 + Math.round(H * 0.018));
    }

    y += headerH + Math.round(H * 0.008);
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, pad, y, W - pad * 2, barH, 10);
    ctx.fill();

    const iconS = Math.min(barH * 0.38, infoFont * 1.4);
    const blocks = [];
    if (locText) blocks.push({ icon: 'pin', lines: locLines });
    if (phoneText) blocks.push({ icon: 'phone', lines: [phoneText] });
    blocks.push({ icon: 'clock', lines: hoursLines });
    const blockGap = Math.round(W * 0.018);
    const usable = W - pad * 2 - 20;
    const bw = (usable - blockGap * (blocks.length - 1)) / blocks.length;
    blocks.forEach((block, bi) => {
      const bx = pad + 10 + bi * (bw + blockGap);
      const midY = y + barH / 2;
      const lineH = Math.round(infoFont * 1.25);
      const blockH = block.lines.length * lineH;
      let ty = midY - blockH / 2 + lineH / 2;
      if (block.icon === 'pin') this.drawIconPin(ctx, bx + iconS * 0.35, midY, iconS, '#fff');
      else if (block.icon === 'phone') this.drawIconPhone(ctx, bx + iconS * 0.3, midY, iconS, '#fff');
      else this.drawIconClock(ctx, bx + iconS * 0.35, midY, iconS, '#fff');
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${infoFont}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      block.lines.forEach((ln) => {
        ctx.fillText(ln, bx + iconS + 8, ty);
        ty += lineH;
      });
    });

    y += barH + Math.round(H * 0.014);
    const titleH = Math.round(H * (type === 'specials' || type === 'buyget' ? 0.06 : 0.05));
    const title = String(this.draft.customTitle || t.titleFallback || 'OUR MENU').toUpperCase();
    if (type === 'specials' || type === 'buyget') {
      ctx.fillStyle = t.accent;
      this.roundRect(ctx, pad, y, W - pad * 2, titleH, 10);
      ctx.fill();
      ctx.fillStyle = t.gold || '#fbbf24';
      ctx.font = `bold ${Math.round(W * 0.016)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(type === 'buyget' ? this.L('buyGetBanner') : this.L('specialOffer'), W / 2, y + titleH * 0.32);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(W * 0.034)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(title, W / 2, y + titleH * 0.68);
    } else if (type === 'takeaway') {
      ctx.fillStyle = t.accentDark || t.accent;
      this.roundRect(ctx, pad, y, W - pad * 2, titleH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(W * 0.034)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, W / 2, y + titleH / 2);
    } else {
      ctx.fillStyle = t.accent;
      this.roundRect(ctx, pad, y, W - pad * 2, titleH, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(W * 0.036)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, W / 2, y + titleH / 2);
    }

    y += titleH + Math.round(H * 0.016);
    const footerReserve = this.draft.includeFooter
      ? Math.round(H * 0.18)
      : Math.round(H * 0.04);
    const gridBottom = H - pad - footerReserve;
    const gridH = Math.max(40, gridBottom - y);

    if (type === 'buyget' && Array.isArray(buyGetOffers) && buyGetOffers.length) {
      this.paintBuyGetOffers(ctx, buyGetOffers, pad, y, W - pad * 2, gridH, t, imgScale, itemNameScale, prodShape);
    } else {
      const gap = Math.round(W * 0.014);
      const pageGrid = this.adaptiveGridForCount(items.length);
      const cols = Math.max(1, pageGrid.cols);
      const rows = Math.max(1, Math.ceil(items.length / cols));
      const cellW = (W - pad * 2 - gap * (cols - 1)) / cols;
      const cellH = (gridH - gap * (rows - 1)) / rows;
      if (centerSingle && items[0]) {
        const scaleBoost = 0.85 + imgScale * 0.35;
        const cw = Math.min(W - pad * 2, cellW * Math.max(1.15, cols * 0.55) * scaleBoost);
        const ch = Math.min(gridH, cellH * Math.max(1.2, rows * 0.7) * scaleBoost);
        const cx = pad + (W - pad * 2 - cw) / 2;
        const cy = y + (gridH - ch) / 2;
        this.paintProductCard(ctx, items[0], cx, cy, cw, ch, t, shop.currency, imgScale, itemNameScale, prodShape);
      } else {
        items.forEach((slot, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          if (row >= rows) return;
          const x = pad + col * (cellW + gap);
          const cy = y + row * (cellH + gap);
          this.paintProductCard(ctx, slot, x, cy, cellW, cellH, t, shop.currency, imgScale, itemNameScale, prodShape);
        });
      }
    }

    if (this.draft.includeFooter) {
      this.paintMenuFooter(ctx, {
        W, H, pad, t, shop, qrImg, isLandscape, orderScale, deliveryScale, qrScale, dateScale, pageIndex, pageCount
      });
    }

    return canvas;
  },

  socialLines() {
    if (this.draft.includeSocials === false) return [];
    const lines = [];
    const fb = String(this.draft.socialFacebook || '').trim();
    const ig = String(this.draft.socialInstagram || '').trim();
    const tt = String(this.draft.socialTiktok || '').trim();
    const wa = String(this.draft.socialWhatsapp || '').trim();
    const web = String(this.draft.socialWebsite || '').trim();
    if (fb) lines.push({ label: 'Facebook', value: fb });
    if (ig) lines.push({ label: 'Instagram', value: ig });
    if (tt) lines.push({ label: 'TikTok', value: tt });
    if (wa) lines.push({ label: 'WhatsApp', value: wa });
    if (web) lines.push({ label: 'Web', value: web });
    return lines;
  },

  paintMenuFooter(ctx, opts) {
    const {
      W, H, pad, t, shop, qrImg, isLandscape, orderScale, deliveryScale, qrScale, dateScale, pageIndex, pageCount
    } = opts;
    const fh = opts.footerHOverride
      || Math.round(H * (isLandscape ? 0.14 : 0.165));
    const fy = H - pad - fh;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    this.roundRect(ctx, pad, fy, W - pad * 2, fh, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, pad, fy, W - pad * 2, fh, 14);
    ctx.stroke();

    // Delivery badge (right) — show full wording
    const badge = String(this.draft.deliveryText || 'FREE DELIVERY for orders R50+');
    const br = Math.min(fh * 0.42, W * (isLandscape ? 0.07 : 0.095)) * Math.min(1.4, deliveryScale);
    const bx = W - pad - br - 14;
    const by = fy + fh * (this.draft.includeDate ? 0.38 : 0.48);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = t.accent;
    ctx.fill();
    ctx.strokeStyle = t.gold || '#fbbf24';
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bWords = badge.split(/\s+/).filter(Boolean);
    let fontSz = Math.round(br * 0.28);
    let bLines = [];
    const wrapBadge = (sz) => {
      ctx.font = `bold ${sz}px system-ui,Segoe UI,sans-serif`;
      const out = [];
      let cur = '';
      bWords.forEach((w) => {
        const test = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(test).width > br * 1.65 && cur) {
          out.push(cur);
          cur = w;
        } else cur = test;
      });
      if (cur) out.push(cur);
      return out;
    };
    bLines = wrapBadge(fontSz);
    while (bLines.length > 5 && fontSz > 8) {
      fontSz -= 1;
      bLines = wrapBadge(fontSz);
    }
    const blh = Math.round(fontSz * 1.12);
    const bStart = by - ((bLines.length - 1) * blh) / 2;
    bLines.forEach((ln, i) => ctx.fillText(ln, bx, bStart + i * blh));

    const leftPad = pad + 16;
    const showQr = this.draft.includeQr !== false && qrImg && shop.orderUrl;
    const qrSize = showQr
      ? Math.min(fh * 0.72, W * (isLandscape ? 0.1 : 0.14)) * qrScale
      : 0;
    const qrX = leftPad;
    const qrY = fy + (fh - qrSize) / 2 - (this.draft.includeDate ? fh * 0.04 : 0);

    if (showQr) {
      ctx.fillStyle = '#fff';
      this.roundRect(ctx, qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 8);
      ctx.fill();
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    }

    const textX = leftPad + (showQr ? qrSize + 16 : 0);
    const textMax = bx - br - 18 - textX;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.accent;
    ctx.font = `bold ${Math.round(W * 0.02 * orderScale)}px system-ui,Segoe UI,sans-serif`;
    ctx.fillText(this.L('orderNow'), textX, fy + fh * 0.2);

    if (showQr) {
      ctx.fillStyle = t.muted;
      ctx.font = `600 ${Math.round(W * 0.011 * orderScale)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(this.L('scanToOrder'), textX, fy + fh * 0.34);
    }

    const socials = this.socialLines();
    let sy = fy + fh * (showQr ? 0.48 : 0.42);
    const sFont = Math.round(W * 0.0115 * orderScale);
    const sLh = Math.round(sFont * 1.35);
    ctx.font = `600 ${sFont}px system-ui,Segoe UI,sans-serif`;
    socials.slice(0, isLandscape ? 5 : 4).forEach((s) => {
      const line = `${s.label}: ${s.value}`;
      ctx.fillStyle = t.text;
      let draw = line;
      while (draw.length > 4 && ctx.measureText(draw).width > textMax) {
        draw = draw.slice(0, -2);
      }
      if (draw !== line) draw += '…';
      ctx.fillText(draw, textX, sy);
      sy += sLh;
    });

    if (this.draft.includeDate && shop.date) {
      ctx.fillStyle = t.gold || '#fbbf24';
      ctx.font = `700 ${Math.round(W * 0.013 * dateScale)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(shop.date, W / 2, fy + fh * 0.9);
    }

    if (pageCount > 1) {
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(W * 0.01)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${pageIndex + 1} / ${pageCount}`, W - pad, H - pad / 2);
    }
  },

  resolveBuyGetBlockRect(areaX, areaY, areaW, areaH) {
    const bg = this.draft.buyGetBlock || {};
    const size = bg.size || 'medium';
    let wFrac = 0.92;
    let hFrac = 0.55;
    if (size === 'small') { wFrac = 0.62; hFrac = 0.38; }
    else if (size === 'medium') { wFrac = 0.82; hFrac = 0.52; }
    else if (size === 'large') { wFrac = 0.98; hFrac = 0.78; }
    else if (size === 'auto') {
      wFrac = areaW > areaH * 1.25 ? 0.88 : 0.94;
      hFrac = areaW > areaH * 1.25 ? 0.58 : 0.62;
    } else if (size === 'custom') {
      wFrac = Math.max(0.4, Math.min(1, (Number(bg.customWidthPct) || 92) / 100));
      hFrac = Math.max(0.25, Math.min(0.95, (Number(bg.customHeightPct) || 55) / 100));
    }
    const bw = Math.round(areaW * wFrac);
    const bh = Math.round(areaH * hFrac);
    const align = bg.align || this.draft.buyGetAlign || 'center';
    let bx = areaX;
    if (align === 'center') bx = areaX + Math.round((areaW - bw) / 2);
    else if (align === 'right') bx = areaX + areaW - bw;
    const by = areaY + Math.round((areaH - bh) / 2);
    return { x: bx, y: by, w: bw, h: bh };
  },

  resolveBuyGetLayout(blockW, blockH) {
    const bg = this.draft.buyGetBlock || {};
    const mode = bg.layout || 'auto';
    if (mode === 'horizontal') return 'horizontal';
    if (mode === 'vertical') return 'vertical';
    // Auto: prefer vertical when narrow / tall
    const ratio = blockW / Math.max(1, blockH);
    return ratio < 1.15 ? 'vertical' : 'horizontal';
  },

  paintBuyGetOffers(ctx, offers, x, y, w, h, t, imgScale, itemNameScale, prodShape) {
    const bg = this.draft.buyGetBlock || {};
    const rect = this.resolveBuyGetBlockRect(x, y, w, h);
    const n = Math.max(1, offers.length);
    const offerGap = Math.round(rect.h * 0.03 * (Number(bg.spacing) || 1));
    const rowH = (rect.h - offerGap * (n - 1)) / n;
    const padScale = Math.max(0.4, Number(bg.padding) || 1);
    const shape = bg.imageShape || prodShape || 'circle';
    const iScale = (Number(bg.imageScale) || 1) * (Number(imgScale) || 1);
    const tScale = (Number(bg.textScale) || 1) * (Number(itemNameScale) || 1);
    const pScale = Number(bg.priceScale) || 1;

    // Outer independent block frame (does not stretch other menu regions)
    ctx.fillStyle = 'rgba(15,23,42,0.35)';
    this.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.35)';
    ctx.lineWidth = Math.max(2, rect.w * 0.003);
    this.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 16);
    ctx.stroke();

    offers.forEach((offer, oi) => {
      const ry = rect.y + oi * (rowH + offerGap);
      const innerPad = Math.round(Math.min(rect.w, rowH) * 0.04 * padScale);
      const titleH = Math.round(rowH * 0.12);
      const title = String(bg.title || this.L('buyGetBanner') || 'BUY X GET X FREE');
      ctx.fillStyle = t.gold || '#fbbf24';
      ctx.font = `bold ${Math.round(Math.min(rect.w * 0.028, titleH * 0.7) * tScale)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, rect.x + rect.w / 2, ry + titleH * 0.55);

      const bodyY = ry + titleH;
      const bodyH = rowH - titleH - innerPad;
      const bodyX = rect.x + innerPad;
      const bodyW = rect.w - innerPad * 2;
      const layout = this.resolveBuyGetLayout(bodyW, bodyH);
      const buy = offer.buySlots || [];
      const free = offer.freeSlots || [];
      const hasCustom = !!offer.freeCustomImg;
      const freeSlots = [...free];
      if (hasCustom) {
        freeSlots.push({ product: { name: 'Free gift', selling_price: 0 }, img: offer.freeCustomImg });
      }
      const buyCount = Math.max(1, buy.length);
      const freeCount = Math.max(1, freeSlots.length);
      const gap = Math.round(Math.min(bodyW, bodyH) * 0.04 * (Number(bg.spacing) || 1));

      if (layout === 'vertical') {
        const arrowH = Math.round(bodyH * 0.1);
        const sideH = (bodyH - arrowH - gap * 2) / 2;
        const buyBoxW = buy.length
          ? (bodyW - gap * (buyCount - 1)) / buyCount
          : bodyW;
        buy.forEach((slot, i) => {
          this.paintBuyGetSide(ctx, slot, bodyX + i * (buyBoxW + gap), bodyY, buyBoxW, sideH, t,
            iScale, tScale, pScale, shape, this.L('buy'), true);
        });
        if (!buy.length) {
          this.paintBuyGetSide(ctx, { product: { name: 'Select BUY', selling_price: 0 }, img: null },
            bodyX, bodyY, bodyW, sideH, t, iScale, tScale, pScale, shape, this.L('buy'), true);
        }
        // Down arrow
        const ax = bodyX + bodyW / 2;
        const ay = bodyY + sideH + gap + arrowH / 2;
        ctx.strokeStyle = t.gold || '#fbbf24';
        ctx.fillStyle = t.gold || '#fbbf24';
        ctx.lineWidth = Math.max(3, bodyW * 0.008);
        ctx.beginPath();
        ctx.moveTo(ax, ay - arrowH * 0.35);
        ctx.lineTo(ax, ay + arrowH * 0.15);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax - 10, ay + arrowH * 0.05);
        ctx.lineTo(ax, ay + arrowH * 0.35);
        ctx.lineTo(ax + 10, ay + arrowH * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(bodyW * 0.035 * tScale)}px system-ui,Segoe UI,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(this.L('get'), ax, ay - arrowH * 0.4);

        const freeY = bodyY + sideH + gap + arrowH + gap;
        const freeBoxW = freeSlots.length
          ? (bodyW - gap * (freeCount - 1)) / freeCount
          : bodyW;
        freeSlots.forEach((slot, i) => {
          this.paintBuyGetSide(ctx, slot, bodyX + i * (freeBoxW + gap), freeY, freeBoxW, sideH, t,
            iScale, tScale, pScale, shape, this.L('getFree') || this.L('free'), false);
        });
        if (!freeSlots.length) {
          this.paintBuyGetSide(ctx, { product: { name: 'Select FREE', selling_price: 0 }, img: null },
            bodyX, freeY, bodyW, sideH, t, iScale, tScale, pScale, shape, this.L('getFree') || this.L('free'), false);
        }
      } else {
        // Horizontal — side by side
        const arrowW = Math.round(bodyW * 0.1);
        const sideW = (bodyW - arrowW - gap * 2) / 2;
        const buyBoxW = buy.length ? (sideW - gap * (buyCount - 1)) / buyCount : sideW;
        buy.forEach((slot, i) => {
          this.paintBuyGetSide(ctx, slot, bodyX + i * (buyBoxW + gap), bodyY, buyBoxW, bodyH, t,
            iScale, tScale, pScale, shape, this.L('buy'), true);
        });
        if (!buy.length) {
          this.paintBuyGetSide(ctx, { product: { name: 'Select BUY', selling_price: 0 }, img: null },
            bodyX, bodyY, sideW, bodyH, t, iScale, tScale, pScale, shape, this.L('buy'), true);
        }
        const ax = bodyX + sideW + gap + arrowW / 2;
        const ay = bodyY + bodyH / 2;
        ctx.strokeStyle = t.gold || '#fbbf24';
        ctx.fillStyle = t.gold || '#fbbf24';
        ctx.lineWidth = Math.max(3, bodyW * 0.006);
        ctx.beginPath();
        ctx.moveTo(ax - arrowW * 0.35, ay);
        ctx.lineTo(ax + arrowW * 0.2, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax + arrowW * 0.05, ay - 10);
        ctx.lineTo(ax + arrowW * 0.35, ay);
        ctx.lineTo(ax + arrowW * 0.05, ay + 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(bodyW * 0.022 * tScale)}px system-ui,Segoe UI,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(this.L('get'), ax, ay - 14);

        const freeX = bodyX + sideW + gap + arrowW + gap;
        const freeBoxW = freeSlots.length ? (sideW - gap * (freeCount - 1)) / freeCount : sideW;
        freeSlots.forEach((slot, i) => {
          this.paintBuyGetSide(ctx, slot, freeX + i * (freeBoxW + gap), bodyY, freeBoxW, bodyH, t,
            iScale, tScale, pScale, shape, this.L('getFree') || this.L('free'), false);
        });
        if (!freeSlots.length) {
          this.paintBuyGetSide(ctx, { product: { name: 'Select FREE', selling_price: 0 }, img: null },
            freeX, bodyY, sideW, bodyH, t, iScale, tScale, pScale, shape, this.L('getFree') || this.L('free'), false);
        }
      }
    });
  },

  paintBuyGetSide(ctx, slot, x, y, w, h, t, imgScale, textScale, priceScale, shape, badge, isBuy) {
    const p = slot?.product || {};
    const img = slot?.img;
    const isFree = !isBuy;
    const pad = Math.round(Math.min(w, h) * 0.06);
    ctx.fillStyle = isFree ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.08)';
    this.roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = isFree ? (t.gold || '#fbbf24') : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();

    // Badge
    const badgeH = Math.max(18, Math.round(h * 0.1 * textScale));
    const badgeW = Math.min(w - pad * 2, Math.max(56, ctx.measureText ? 0 : 72));
    ctx.font = `bold ${Math.round(Math.min(13, w * 0.08) * textScale)}px system-ui,Segoe UI,sans-serif`;
    const tw = ctx.measureText(String(badge)).width + 18;
    const bw = Math.min(w - pad * 2, Math.max(badgeW, tw));
    ctx.fillStyle = isFree ? (t.gold || '#fbbf24') : t.accent;
    this.roundRect(ctx, x + pad, y + pad, bw, badgeH, 6);
    ctx.fill();
    ctx.fillStyle = isFree ? '#0f172a' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(badge), x + pad + bw / 2, y + pad + badgeH / 2);

    // Price + name reserved
    const priceH = Math.max(20, Math.round(h * 0.12 * priceScale));
    const nameH = Math.max(16, Math.round(h * 0.14 * textScale));
    const bottomReserve = priceH + nameH + pad * 2;
    const imgTop = y + pad + badgeH + pad;
    const imgAvailH = Math.max(20, (y + h - pad - bottomReserve) - imgTop);
    const imgAvailW = w - pad * 2;
    let imgSize = Math.min(imgAvailW, imgAvailH) * Math.max(0.5, Math.min(1.4, imgScale));
    // Keep image inside box
    imgSize = Math.min(imgSize, imgAvailW, imgAvailH);
    const ix = x + (w - imgSize) / 2;
    const iy = imgTop + (imgAvailH - imgSize) / 2;

    ctx.save();
    const sh = String(shape || 'circle');
    if (sh === 'circle') {
      ctx.beginPath();
      ctx.arc(ix + imgSize / 2, iy + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    } else if (sh === 'rounded') {
      this.roundRect(ctx, ix, iy, imgSize, imgSize, Math.max(8, imgSize * 0.18));
      ctx.clip();
    } else if (sh === 'rectangle') {
      const rw = imgSize;
      const rh = imgSize * 0.78;
      const ry = iy + (imgSize - rh) / 2;
      this.roundRect(ctx, ix, ry, rw, rh, 6);
      ctx.clip();
    } else {
      this.roundRect(ctx, ix, iy, imgSize, imgSize, 6);
      ctx.clip();
    }
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(ix, iy, imgSize, imgSize);
    if (img) this.drawContain(ctx, img, ix, iy, imgSize, imgSize);
    ctx.restore();

    // Stroke shape
    ctx.strokeStyle = isFree ? (t.gold || '#fbbf24') : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = Math.max(2, w * 0.01);
    if (sh === 'circle') {
      ctx.beginPath();
      ctx.arc(ix + imgSize / 2, iy + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (sh === 'rectangle') {
      const rh = imgSize * 0.78;
      const ry = iy + (imgSize - rh) / 2;
      this.roundRect(ctx, ix, ry, imgSize, rh, 6);
      ctx.stroke();
    } else {
      this.roundRect(ctx, ix, iy, imgSize, imgSize, sh === 'rounded' ? Math.max(8, imgSize * 0.18) : 6);
      ctx.stroke();
    }

    // Name
    const nameY = y + h - pad - priceH - nameH + 2;
    ctx.fillStyle = t.text;
    const nameSize = Math.min(Math.round(w * 0.09 * textScale), Math.round(nameH * 0.55));
    ctx.font = `bold ${nameSize}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    this.wrapText(ctx, String(p.name || 'Item'), x + w / 2, nameY, w - pad * 2, Math.round(nameSize * 1.15), 2);

    // Price from live product / override
    const price = this.money(this.menuPrice(p)).replace(/\.00$/, '');
    if (!(Number(p.selling_price) === 0 && String(p.name || '').toLowerCase().includes('free'))) {
      const ph = priceH;
      ctx.font = `bold ${Math.round(Math.min(w * 0.1, ph * 0.5) * priceScale)}px system-ui,Segoe UI,sans-serif`;
      const pw = Math.max(w * 0.4, ctx.measureText(price).width + w * 0.1);
      const px = x + (w - pw) / 2;
      const py = y + h - pad - ph;
      ctx.fillStyle = isFree ? (t.gold || '#fbbf24') : t.accent;
      this.roundRect(ctx, px, py, pw, ph, 8);
      ctx.fill();
      ctx.fillStyle = isFree ? '#0f172a' : '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(price, x + w / 2, py + ph / 2);
    }
  },

  paintOfferBox(ctx, slot, x, y, w, h, t, imgScale, itemNameScale, prodShape, badge) {
    // Legacy path — route through new side painter
    const isBuy = !String(badge || '').toUpperCase().match(/FREE|GRATIS|MAHALA|SIMAHLA/);
    const bg = this.draft.buyGetBlock || {};
    this.paintBuyGetSide(
      ctx, slot, x, y, w, h, t,
      (Number(bg.imageScale) || 1) * (imgScale || 1),
      (Number(bg.textScale) || 1) * (itemNameScale || 1),
      Number(bg.priceScale) || 1,
      bg.imageShape || prodShape || 'circle',
      badge,
      isBuy
    );
  },

  /**
   * Map 9-point position key → { ax, ay } anchors in 0..1 within a box.
   */
  textAnchor(pos) {
    const p = String(pos || 'bottom-center');
    const map = {
      'top-left': [0, 0], 'top-center': [0.5, 0], 'top-right': [1, 0],
      'middle-left': [0, 0.5], center: [0.5, 0.5], 'middle-right': [1, 0.5],
      'bottom-left': [0, 1], 'bottom-center': [0.5, 1], 'bottom-right': [1, 1]
    };
    return map[p] || map['bottom-center'];
  },

  paintProductCard(ctx, slot, x, y, w, h, t, currency, imgScale = 1, itemNameScale = 1, prodShape = 'circle', cardOpts = {}) {
    const p = slot.product;
    const img = slot.img;
    const type = this.draft.menuType;
    const scale = Math.max(0.2, Math.min(3, Number(imgScale) || 1));
    const nameScale = Math.max(0.45, Math.min(2.8, Number(itemNameScale) || 1));
    const priceScale = Math.max(0.45, Math.min(2.8, Number(this.draft.priceScale) || 1));
    const shape = prodShape === 'square' || this.draft.productImageShape === 'square' ? 'square' : 'circle';
    const fitContain = cardOpts?.fit === 'contain';
    const padScale = Math.max(0.5, Math.min(1.8, Number(this.draft.textPadding) || 1));
    const sharedPos = this.draft.textPosition || 'bottom-center';
    const namePos = this.draft.namePosition || sharedPos;
    const pricePos = this.draft.pricePosition || sharedPos;
    const textAlign = this.draft.textAlign || 'center';
    const useTextBg = this.draft.textBackground !== false;
    const nameColor = this.draft.nameColor || t.text;
    const priceFg = this.draft.priceColor || '#fff';

    if (type === 'specials' || type === 'buyget') {
      ctx.fillStyle = 'rgba(251, 191, 36, 0.08)';
      this.roundRect(ctx, x, y, w, h, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
      ctx.lineWidth = 2;
      this.roundRect(ctx, x, y, w, h, 16);
      ctx.stroke();
    } else if (type === 'takeaway') {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      this.roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      this.roundRect(ctx, x, y, w, h, 14);
      ctx.fill();
    }

    const stockPrice = Number(p.selling_price) || 0;
    const nowPrice = this.menuPrice(p);
    const showWas = stockPrice > 0 && Math.abs(stockPrice - nowPrice) > 0.001;
    const pad = Math.round(Math.min(w, h) * 0.04 * padScale);
    const priceH = Math.max(18, Math.round(h * (showWas ? 0.16 : 0.12) * priceScale));
    const nameH = Math.max(16, Math.round(h * 0.12 * nameScale));

    // Image size — freely resizable; can be very small or fill most of the card
    const maxImg = Math.min(w - pad * 2, h - pad * 2);
    const baseImg = Math.min(w * 0.72, h * 0.58, maxImg);
    const imgSize = Math.max(12, Math.min(maxImg, baseImg * scale));
    const ix = x + (w - imgSize) / 2;
    // Keep image near top by default; when text is top-positioned, nudge image down a bit
    const nameIsTop = String(namePos).startsWith('top');
    const iy = nameIsTop
      ? y + pad + nameH + Math.round(h * 0.02)
      : y + Math.round(h * 0.05);

    ctx.save();
    if (shape === 'square') {
      this.roundRect(ctx, ix, iy, imgSize, imgSize, Math.max(8, imgSize * 0.12));
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.arc(ix + imgSize / 2, iy + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(ix, iy, imgSize, imgSize);
    if (img) {
      if (fitContain) this.drawContain(ctx, img, ix, iy, imgSize, imgSize);
      else this.drawCover(ctx, img, ix, iy, imgSize, imgSize);
    }
    ctx.restore();
    ctx.strokeStyle = type === 'specials' || type === 'buyget' ? (t.gold || '#fbbf24') : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = Math.max(2, w * 0.012);
    if (shape === 'square') {
      this.roundRect(ctx, ix, iy, imgSize, imgSize, Math.max(8, imgSize * 0.12));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ix + imgSize / 2, iy + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    const placeBlock = (posKey, blockW, blockH) => {
      const [ax, ay] = this.textAnchor(posKey);
      let bx = x + pad + (w - pad * 2 - blockW) * ax;
      let by = y + pad + (h - pad * 2 - blockH) * ay;
      bx = Math.max(x + pad / 2, Math.min(x + w - blockW - pad / 2, bx));
      by = Math.max(y + pad / 2, Math.min(y + h - blockH - pad / 2, by));
      return { bx, by };
    };

    const name = String(p.name || 'Item');
    const nameSize = Math.min(Math.round(w * 0.085 * nameScale), Math.round(nameH * 0.7));
    ctx.font = `bold ${nameSize}px system-ui,Segoe UI,sans-serif`;
    const lineH = Math.round(nameSize * 1.15);
    const nameBlockH = lineH * 2;
    const nameBlockW = Math.min(w - pad * 2, w * 0.92);
    const { bx: nameX, by: nameY } = placeBlock(namePos, nameBlockW, nameBlockH);

    if (useTextBg && String(namePos) !== String(pricePos)) {
      ctx.fillStyle = 'rgba(15,23,42,0.55)';
      this.roundRect(ctx, nameX - 4, nameY - 2, nameBlockW + 8, nameBlockH + 4, 6);
      ctx.fill();
    }

    ctx.fillStyle = nameColor;
    ctx.textAlign = textAlign === 'left' ? 'left' : (textAlign === 'right' ? 'right' : 'center');
    ctx.textBaseline = 'top';
    const nameCx = textAlign === 'left' ? nameX
      : (textAlign === 'right' ? nameX + nameBlockW : nameX + nameBlockW / 2);
    this.wrapText(ctx, name, nameCx, nameY, nameBlockW, lineH, 2);

    if (Number(p.selling_price) === 0 && String(p.name || '').toLowerCase().includes('free')) {
      return;
    }

    const price = this.money(nowPrice).replace(/\.00$/, '');
    const wasLabel = showWas
      ? `${this.L('was')} ${this.money(stockPrice).replace(/\.00$/, '')}`
      : '';
    ctx.font = `bold ${Math.round(Math.min(w * 0.1, priceH * (showWas ? 0.42 : 0.55)) * priceScale)}px system-ui,Segoe UI,sans-serif`;
    const priceW = ctx.measureText(price).width;
    let wasW = 0;
    if (showWas) {
      ctx.font = `600 ${Math.round(Math.min(w * 0.07, priceH * 0.28) * priceScale)}px system-ui,Segoe UI,sans-serif`;
      wasW = ctx.measureText(wasLabel).width;
    }
    const pw = Math.max(w * 0.4, Math.max(priceW, wasW) + w * 0.12 * padScale);
    const { bx: px, by: priceY } = placeBlock(pricePos, pw, priceH);
    ctx.fillStyle = type === 'specials' || type === 'buyget' ? (t.gold || '#fbbf24') : t.accent;
    if (useTextBg || true) {
      this.roundRect(ctx, px, priceY, pw, priceH, 8);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (showWas) {
      ctx.fillStyle = type === 'specials' || type === 'buyget' ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.75)';
      ctx.font = `600 ${Math.round(Math.min(w * 0.07, priceH * 0.28) * priceScale)}px system-ui,Segoe UI,sans-serif`;
      const wy = priceY + priceH * 0.32;
      ctx.fillText(wasLabel, px + pw / 2, wy);
      const strikeY = wy;
      const sw = ctx.measureText(wasLabel).width;
      ctx.strokeStyle = type === 'specials' || type === 'buyget' ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1.5, w * 0.006);
      ctx.beginPath();
      ctx.moveTo(px + pw / 2 - sw / 2 - 2, strikeY);
      ctx.lineTo(px + pw / 2 + sw / 2 + 2, strikeY);
      ctx.stroke();
      ctx.fillStyle = type === 'specials' || type === 'buyget' ? '#0f172a' : priceFg;
      ctx.font = `bold ${Math.round(Math.min(w * 0.095, priceH * 0.42) * priceScale)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(price, px + pw / 2, priceY + priceH * 0.7);
    } else {
      ctx.fillStyle = type === 'specials' || type === 'buyget' ? '#0f172a' : priceFg;
      ctx.font = `bold ${Math.round(Math.min(w * 0.1, priceH * 0.55) * priceScale)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(price, px + pw / 2, priceY + priceH / 2);
    }
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
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    const shop = this.shopBlock();
    const base = `menu-${String(shop.shopName).replace(/\W+/g, '-').toLowerCase()}-hd`;
    this.generatedPages.forEach((pg, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.download = `${base}-p${i + 1}.png`;
        a.href = pg.canvas
          ? pg.canvas.toDataURL('image/png')
          : pg.dataUrl;
        a.click();
      }, i * 400);
    });
    this.toast('High-resolution PNG downloaded', 'success');
  },

  downloadJpegPages() {
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    const shop = this.shopBlock();
    const base = `menu-${String(shop.shopName).replace(/\W+/g, '-').toLowerCase()}-hd`;
    this.generatedPages.forEach((pg, i) => {
      setTimeout(() => {
        const canvas = pg.canvas;
        let href = pg.dataUrl;
        if (canvas) {
          // White underlay so JPEG has no black transparency
          const out = document.createElement('canvas');
          out.width = canvas.width;
          out.height = canvas.height;
          const octx = out.getContext('2d');
          octx.fillStyle = '#0f172a';
          octx.fillRect(0, 0, out.width, out.height);
          octx.drawImage(canvas, 0, 0);
          href = out.toDataURL('image/jpeg', 0.95);
        }
        const a = document.createElement('a');
        a.download = `${base}-p${i + 1}.jpg`;
        a.href = href;
        a.click();
      }, i * 400);
    });
    this.toast('High-resolution JPEG downloaded', 'success');
  },

  async downloadSocialVersion() {
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    const shop = this.shopBlock();
    const base = `menu-${String(shop.shopName).replace(/\W+/g, '-').toLowerCase()}-social`;
    const targetW = 1080;
    const targetH = 1920;
    this.generatedPages.forEach((pg, i) => {
      setTimeout(() => {
        const src = pg.canvas;
        if (!src) return;
        const out = document.createElement('canvas');
        out.width = targetW;
        out.height = targetH;
        const octx = out.getContext('2d');
        octx.fillStyle = '#0f172a';
        octx.fillRect(0, 0, targetW, targetH);
        const scale = Math.min(targetW / src.width, targetH / src.height);
        const dw = Math.round(src.width * scale);
        const dh = Math.round(src.height * scale);
        const dx = Math.round((targetW - dw) / 2);
        const dy = Math.round((targetH - dh) / 2);
        octx.drawImage(src, dx, dy, dw, dh);
        const a = document.createElement('a');
        a.download = `${base}-p${i + 1}.jpg`;
        a.href = out.toDataURL('image/jpeg', 0.92);
        a.click();
      }, i * 400);
    });
    this.toast('WhatsApp / social story images downloaded (1080×1920)', 'success');
  },

  loadScriptOnce(src, globalCheck) {
    return new Promise((resolve, reject) => {
      if (globalCheck()) return resolve();
      const existing = document.querySelector(`script[data-mb-src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Script failed')));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.mbSrc = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  },

  async ensureJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    await this.loadScriptOnce(
      'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
      () => !!(window.jspdf?.jsPDF || window.jsPDF)
    );
    return window.jspdf?.jsPDF || window.jsPDF;
  },

  async savePdf() {
    if (!this.generatedPages.length) return this.toast('Generate a menu first', 'error');
    const shop = this.shopBlock();
    const { wMm, hMm } = this.canvasSize();
    try {
      const JsPDF = await this.ensureJsPdf();
      const orient = wMm > hMm ? 'landscape' : 'portrait';
      const doc = new JsPDF({
        orientation: orient,
        unit: 'mm',
        format: [wMm, hMm],
        compress: true
      });
      this.generatedPages.forEach((pg, i) => {
        if (i > 0) doc.addPage([wMm, hMm], orient);
        const canvas = pg.canvas;
        let img = pg.dataUrl;
        if (canvas) {
          const out = document.createElement('canvas');
          out.width = canvas.width;
          out.height = canvas.height;
          const octx = out.getContext('2d');
          octx.fillStyle = '#0f172a';
          octx.fillRect(0, 0, out.width, out.height);
          octx.drawImage(canvas, 0, 0);
          img = out.toDataURL('image/jpeg', 0.95);
        }
        doc.addImage(img, 'JPEG', 0, 0, wMm, hMm, undefined, 'FAST');
      });
      const name = `menu-${String(shop.shopName).replace(/\W+/g, '-').toLowerCase()}-print.pdf`;
      doc.save(name);
      this.toast('Print-quality PDF saved', 'success');
    } catch (err) {
      this.printMenu();
      this.toast('PDF library unavailable — use Print → Save as PDF for high quality', 'info');
    }
  },

  dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(parts[1] || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  },

  async sharePublishCC() {
    if (!this.generatedPages?.length) return this.toast('Generate a menu first', 'error');
    const shop = this.shopBlock?.() || {};
    const title = this.draft?.customTitle || 'Our Menu';
    const body = `${shop.shopName || 'Shop'} — ${title}\n${shop.branchName ? shop.branchName + '\n' : ''}${shop.phone ? 'Call/WhatsApp: ' + shop.phone : ''}\nSee our latest menu.`;
    const mediaUrl = this.generatedPages[0]?.dataUrl || null;
    const open = async () => {
      if (!window.CCSharePublish?.open) {
        try {
          if (typeof Utils?.loadScript === 'function') await Utils.loadScript('js/pages/admin-communication-center.js');
        } catch (_) { /* */ }
      }
      if (!window.CCSharePublish?.open) {
        return this.toast('Communication Center Share unavailable — open Admin → Communication Center once, then retry', 'error');
      }
      window.CCSharePublish.open({
        title,
        body,
        mediaUrl,
        sourceModule: 'menu-builder',
        app: this.app || window.App
      });
    };
    await open();
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
