/**
 * Admin — Promo Video Builder
 * Automatic promotional videos from products, combos, promotions, and Menu Builder.
 * Single source of truth: live product/combo data (no duplication).
 */
window.AdminPromoVideoBuilderPage = {
  el: null,
  app: null,
  mode: 'create', // create | library
  libraryTab: 'videos', // videos | templates | music
  sourceTab: 'products', // products | combos | promotions | menus
  productsLoading: false,
  products: [],
  combos: [],
  branches: [],
  settings: {},
  selectedIds: new Set(),
  selectedCombos: new Set(),
  searchQ: '',
  branchId: 'all',
  videos: [],
  musicLibrary: [],
  _musicBlob: null,
  _musicArrayBuffer: null,
  _qrImg: null,
  scenes: [],
  generatedBlob: null,
  generatedUrl: null,
  previewRaf: 0,
  previewTime: 0,
  previewPlaying: false,
  generating: false,
  generateProgress: 0,
  pendingFromMenu: null,
  timelineManual: false,
  timeline: [],
  _computedTotalDuration: 0,
  _clipVideoEls: {},
  _lastVoiceSceneId: null,

  draft: {
    title: 'Promo Video',
    template: 'showcase',
    format: 'vertical', // vertical | landscape | square
    duration: 30,
    customDuration: 30,
    transition: 'fade',
    musicId: '',
    musicDataUrl: '',
    musicName: '',
    musicVolume: 0.7,
    musicFadeIn: true,
    musicFadeOut: true,
    includeLogo: true,
    showPrices: true,
    showContact: true,
    showDelivery: true,
    showSocials: true,
    promoBadge: 'SPECIAL OFFER',
    theme: 'red',
    sourceLabel: 'Products',
    quality: 'hd',
    outputWhatsApp: false,
    outputTv: false,
    loopPreview: false,
    designMode: 'new', // new | menu
    voiceEnabled: false,
    voicePreview: false,
    voiceText: '',
    voiceRate: 1,
    voiceVolume: 1,
    voiceGender: 'female',
    captionsOnVideo: false,
    burnCaptions: true,
    safeAreaGuide: false,
    showWatermark: false,
    watermarkText: '',
    autoCreateFlow: true,
    buyGetBuyQty: 2,
    buyGetFreeQty: 1,
    promoCaption: '',
    thumbnailTime: 0,
    clipTrimStart: 0,
    clipTrimEnd: 5,
    productImageShape: 'circle', // circle | square
    outroContactScale: 1,
    outroBranchScale: 1,
    outroDeliveryScale: 1,
    outroOrderScale: 1,
    outroQrScale: 1
  },

  audioTracks: [],
  _audioBuffers: {},
  _previewMix: null,
  _trackPreviewAudio: null,
  _voiceRecorder: null,
  _voiceChunks: [],
  previewAudioMuted: false,

  TEMPLATES: [
    { id: 'showcase', name: 'Product Showcase', blurb: 'One product per scene with clean branding' },
    { id: 'fullmenu', name: 'Full Menu', blurb: 'Animated menu-style product parade' },
    { id: 'combo', name: 'Combo Promotion', blurb: 'Highlight meal deals and combos' },
    { id: 'buyget', name: 'Buy X Get Free', blurb: 'Promo offer storytelling' },
    { id: 'weekend', name: 'Weekend Special', blurb: 'Weekend urgency + products' },
    { id: 'flash', name: 'Flash Sale', blurb: 'Fast cuts, bold prices' },
    { id: 'new', name: 'New Product', blurb: 'Launch a new item' },
    { id: 'restaurant', name: 'Restaurant Promotion', blurb: 'Brand-first food promo' },
    { id: 'simple', name: 'Simple Product Ad', blurb: 'Minimal single-product ad' }
  ],

  FORMATS: {
    vertical: { w: 1080, h: 1920, label: '9:16 Vertical (WhatsApp / Reels / TikTok)', cls: '' },
    landscape: { w: 1920, h: 1080, label: '16:9 Landscape (TV / YouTube / Facebook)', cls: 'is-landscape' },
    square: { w: 1080, h: 1080, label: '1:1 Square (Social feed)', cls: 'is-square' }
  },

  THEMES: {
    red: { accent: '#ef4444', accentDark: '#dc2626', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    yellow: { accent: '#eab308', accentDark: '#ca8a04', gold: '#fde047', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    green: { accent: '#22c55e', accentDark: '#16a34a', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' },
    blue: { accent: '#3b82f6', accentDark: '#2563eb', gold: '#fbbf24', bg: '#0f172a', card: '#1e293b', text: '#f8fafc', muted: '#94a3b8' }
  },

  PROMO_BADGES: ['SPECIAL OFFER', 'TODAY ONLY', 'WEEKEND SPECIAL', 'BUY 2 GET 1 FREE', 'NEW', 'POPULAR', 'BEST SELLER', 'SPECIAL', 'LIMITED', 'ORDER NOW', 'FLASH SALE', ''],

  LIB_KEY: 'shoppos_promo_videos_v1',
  MUSIC_KEY: 'shoppos_promo_music_v1',
  FROM_MENU_KEY: 'shoppos_video_from_menu',

  esc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v)
      : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  money(n) {
    const c = this.settings?.currency || this.app?.settings?.currency || 'R';
    return (typeof Utils !== 'undefined' && Utils.formatMoney)
      ? Utils.formatMoney(Number(n) || 0, c)
      : `${c}${(Number(n) || 0).toFixed(2)}`;
  },
  toast(msg, type) { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(msg, type || 'info'); },

  ensureCss() {
    const href = 'css/promo-video-builder.css?v=11';
    let l = document.getElementById('promo-video-builder-css');
    if (l) { l.href = href; return; }
    l = document.createElement('link');
    l.id = 'promo-video-builder-css';
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  },

  productImageUrl(p) {
    if (typeof Utils !== 'undefined' && Utils.productImageUrl) return Utils.productImageUrl(p);
    return p?.id ? `/api/product-image/${p.id}` : '';
  },
  comboImageUrl(c) {
    if (typeof Utils !== 'undefined' && Utils.comboImageUrl) return Utils.comboImageUrl(c);
    return c?.id ? `/api/combo-image/${c.id}` : '';
  },

  async render(el, adminPage) {
    this.el = el;
    this.app = adminPage?.app || adminPage || (typeof App !== 'undefined' ? App : null);
    this.ensureCss();
    this.settings = this.app?.settings || this.settings || {};
    this.loadLocalLibraries();
    this.consumeMenuHandoff();
    this.productsLoading = !this.products.length;
    this.paint();
    this.bootstrap();
  },

  loadLocalLibraries() {
    try {
      this.videos = JSON.parse(localStorage.getItem(this.LIB_KEY) || '[]');
      if (!Array.isArray(this.videos)) this.videos = [];
    } catch (_) { this.videos = []; }
    try {
      this.musicLibrary = JSON.parse(localStorage.getItem(this.MUSIC_KEY) || '[]');
      if (!Array.isArray(this.musicLibrary)) this.musicLibrary = [];
    } catch (_) { this.musicLibrary = []; }
  },

  saveVideos() {
    try { localStorage.setItem(this.LIB_KEY, JSON.stringify(this.videos.slice(0, 40))); } catch (_) { /* quota */ }
  },
  saveMusic() {
    try { localStorage.setItem(this.MUSIC_KEY, JSON.stringify(this.musicLibrary.slice(0, 20))); } catch (_) { /* */ }
  },

  consumeMenuHandoff() {
    try {
      const raw = localStorage.getItem(this.FROM_MENU_KEY) || sessionStorage.getItem(this.FROM_MENU_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.productIds)) return;
      this.pendingFromMenu = data;
      this.sourceTab = 'menus';
      this.draft.template = data.menuType === 'buyget' ? 'buyget'
        : data.menuType === 'specials' ? 'weekend' : 'fullmenu';
      this.draft.theme = data.theme || this.draft.theme;
      this.draft.promoBadge = data.menuType === 'buyget' ? 'BUY 2 GET 1 FREE'
        : data.menuType === 'specials' ? 'SPECIAL OFFER' : this.draft.promoBadge;
      this.draft.title = data.title || 'Menu Promo Video';
      this.draft.sourceLabel = `Menu: ${data.title || 'Saved menu'}`;
      this.selectedIds = new Set((data.productIds || []).map(Number));
      if (data.branchId) this.branchId = String(data.branchId);
      localStorage.removeItem(this.FROM_MENU_KEY);
      sessionStorage.removeItem(this.FROM_MENU_KEY);
      this.toast('Loaded Menu Builder selection — adjust settings and Generate Video', 'success');
    } catch (_) { /* */ }
  },

  async bootstrap() {
    try {
      if (window.AdminMenuBuilderPage?.products?.length && !this.products.length) {
        this.products = window.AdminMenuBuilderPage.products.slice();
        this.productsLoading = false;
        this.refreshContentList();
      }
    } catch (_) { /* */ }

    // Resolve-wrap so a missing/throwing loadMeta never blocks product load
    const metaP = Promise.resolve()
      .then(() => this.loadMeta())
      .then(() => {
        const sel = document.getElementById('pvb-branch');
        if (sel && this.branches.length) {
          const cur = this.branchId;
          sel.innerHTML = `<option value="all">All / shop default</option>${this.branches.map((b) =>
            `<option value="${b.id}" ${String(cur) === String(b.id) ? 'selected' : ''}>${this.esc(b.name)}</option>`
          ).join('')}`;
        }
      })
      .catch(() => {});

    const prodP = this.loadProducts().then(() => {
      this.productsLoading = false;
      if (this.pendingFromMenu?.productIds?.length) {
        this.selectedIds = new Set(this.pendingFromMenu.productIds.map(Number));
        this.pendingFromMenu = null;
      }
      this.refreshContentList();
      this.buildScenes();
      const sc = document.getElementById('pvb-timeline') || document.getElementById('pvb-scenes');
      if (sc) {
        sc.innerHTML = this.timelineHtml();
        this.bindTimelineDnD?.(sc);
      }
      this.drawPreviewFrame(this.previewTime || 0);
    }).catch(() => {
      this.productsLoading = false;
      this.refreshContentList();
    });

    const comboP = this.loadCombos().then(() => {
      if (this.sourceTab === 'combos') this.refreshContentList();
    }).catch(() => {});

    await Promise.all([metaP, prodP, comboP]);
  },

  refreshContentList() {
    const list = document.getElementById('pvb-list');
    if (list) {
      list.innerHTML = this.contentListHtml();
      this.bindListChecks();
    }
  },

  normalizeProductList(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
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
        category_name: p.category_name || '',
        is_promo: p.is_promo,
        is_active: p.is_active,
        promo_active: !!(p.promo_active || Number(p.is_promo)),
        original_price: Number(p.original_price) || 0,
        was_price: Number(p.was_price || p.original_price) || 0,
        video_url: p.video_url || p.promo_video || ''
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  },

  async loadProducts() {
    if (this._productsPromise) return this._productsPromise;
    this.productsLoading = true;
    this._productsPromise = (async () => {
      try {
        const get = API.getProducts?._uncached || API.getProducts;
        if (typeof get !== 'function') {
          this.products = this.products || [];
          return this.products;
        }
        const attempts = [
          { admin_list: true, omit_images: true, all_branches: true },
          { admin_list: true, omit_images: true },
          { admin_list: true, all_branches: true },
          { combo_picker: true },
          { omit_images: true },
          {}
        ];
        for (const filters of attempts) {
          try {
            const pr = await Promise.race([
              get(filters),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
            ]);
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
        } catch (_) { /* */ }
        if (window.AdminMenuBuilderPage?.products?.length) {
          this.products = this.normalizeProductList(window.AdminMenuBuilderPage.products);
          return this.products;
        }
        this.products = this.products || [];
        return this.products;
      } finally {
        this.productsLoading = false;
        this._productsPromise = null;
      }
    })();
    return this._productsPromise;
  },

  async loadCombos() {
    try {
      const res = await Promise.race([
        API.getCombos?.({ list_only: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
      ]);
      let list = res?.success !== false ? (res?.data ?? res ?? []) : [];
      if (!Array.isArray(list)) list = [];
      this.combos = list;
    } catch (_) {
      this.combos = this.combos || [];
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
    const userBranch = this.app?.user?.branch_id;
    if ((!this.branchId || this.branchId === 'all') && userBranch
      && this.branches.some((b) => Number(b.id) === Number(userBranch))) {
      this.branchId = String(userBranch);
    } else if ((!this.branchId || this.branchId === 'all') && this.branches.length === 1) {
      this.branchId = String(this.branches[0].id);
    }
  },

  shopBlock() {
    const s = this.settings || {};
    const b = this.branches.find((x) => String(x.id) === String(this.branchId)) || null;
    return {
      shopName: s.shop_name || s.business_name || 'Shop',
      branchName: b?.name || (this.branchId === 'all' ? '' : ''),
      address: (b?.address && String(b.address).trim()) || s.address || '',
      phone: (b?.phone && String(b.phone).trim()) || s.phone || '',
      hours: this.resolveHours(),
      logoUrl: '/api/logo',
      currency: s.currency || 'R',
      delivery: s.delivery_info || s.free_delivery_text || 'FREE DELIVERY for orders R50+',
      orderUrl: (typeof Utils !== 'undefined' && Utils.getOnlineOrderUrl) ? Utils.getOnlineOrderUrl() : '',
      socialFacebook: s.social_facebook || s.facebook || '',
      socialInstagram: s.social_instagram || s.instagram || '',
      socialWhatsapp: s.whatsapp || s.phone || ''
    };
  },

  resolveHours() {
    const s = this.settings || {};
    const oh = s.operating_hours_settings || {};
    const weekly = oh.weekly || oh.days || [];
    if (Array.isArray(weekly) && weekly.length) {
      const openDays = weekly.filter((d) => !d.closed && d.open && d.close);
      if (openDays.length) {
        const opens = openDays.map((d) => d.open);
        const closes = openDays.map((d) => d.close);
        if (opens.every((v) => v === opens[0]) && closes.every((v) => v === closes[0])) {
          return `Open daily from ${opens[0]} to ${closes[0]}`;
        }
      }
    }
    return s.operating_hours_text || s.opening_hours || 'Open daily';
  },

  formatSize() {
    return this.FORMATS[this.draft.format] || this.FORMATS.vertical;
  },

  targetDurationSetting() {
    if (Number(this.draft.duration) === 0) return Math.max(5, Number(this.draft.customDuration) || 30);
    return Math.max(5, Number(this.draft.duration) || 30);
  },

  totalDuration() {
    if (this._computedTotalDuration > 0) return this._computedTotalDuration;
    return this.targetDurationSetting();
  },

  defaultSceneDuration(type, itemCount) {
    const total = this.targetDurationSetting();
    if (type === 'intro') return Math.min(3.2, total * 0.12);
    if (type === 'outro') return Math.min(4.5, total * 0.18);
    if (type === 'text') return 3;
    if (type === 'clip') return 5;
    const intro = Math.min(3.2, total * 0.12);
    const outro = Math.min(4.5, total * 0.18);
    const mid = Math.max(0.5, total - intro - outro);
    const n = Math.max(1, itemCount || 1);
    return mid / n;
  },

  materializeTimeline() {
    const list = this.timeline?.length ? this.timeline : this.scenes;
    if (!list?.length) return;
    let t = 0;
    list.forEach((scene) => {
      const dur = Math.max(0.5, Number(scene.duration) || this.defaultSceneDuration(scene.type, 1));
      scene.duration = dur;
      scene.start = t;
      scene.end = t + dur;
      t += dur;
    });
    this.timeline = list;
    this.scenes = list;
    this._computedTotalDuration = t;
  },

  selectedItems() {
    if (this.sourceTab === 'combos') {
      return this.combos.filter((c) => this.selectedCombos.has(Number(c.id))).map((c) => ({
        kind: 'combo',
        id: c.id,
        name: c.name || 'Combo',
        price: Number(c.selling_price ?? c.price ?? 0),
        imageUrl: this.comboImageUrl(c),
        videoUrl: c.video_url || c.promo_video || '',
        badge: 'COMBO',
        selling_price: Number(c.selling_price ?? c.price ?? 0),
        original_price: Number(c.original_price) || 0,
        was_price: Number(c.was_price || c.original_price) || 0,
        promo_active: !!c.promo_active,
        description: c.description || c.details || '',
        snapshotAt: Date.now()
      }));
    }
    // products / promotions / menus all resolve to live products
    return this.products.filter((p) => this.selectedIds.has(Number(p.id))).map((p) => {
      const sell = Number(p.selling_price) || 0;
      const orig = Number(p.original_price || p.was_price) || 0;
      const promoActive = !!(p.promo_active || Number(p.is_promo));
      let badge = promoActive ? 'PROMO' : '';
      if (this.draft.promoBadge && !badge) badge = this.draft.promoBadge;
      return {
        kind: 'product',
        id: p.id,
        name: p.name || 'Item',
        price: sell,
        selling_price: sell,
        original_price: orig,
        was_price: Number(p.was_price) || orig,
        promo_active: promoActive,
        imageUrl: this.productImageUrl(p),
        videoUrl: p.video_url || p.promo_video || p.media_video || '',
        badge,
        description: p.description || p.short_description || p.details || p.category_name || '',
        sku: p.sku || '',
        snapshotAt: Date.now()
      };
    });
  },

  syncTimelineWithSelection(items) {
    const list = this.timeline || [];
    const intro = list.find((s) => s.type === 'intro') || null;
    const outro = list.find((s) => s.type === 'outro') || null;
    const mid = list.filter((s) => s.type !== 'intro' && s.type !== 'outro');
    const itemIds = new Set(items.map((it) => `item-${it.kind}-${it.id}`));
    const kept = mid.filter((s) => {
      if (s.type === 'clip' || s.type === 'text') return true;
      if (s.type === 'product' && s.id === 'empty') return !items.length;
      return itemIds.has(s.id);
    });
    items.forEach((it) => {
      const id = `item-${it.kind}-${it.id}`;
      if (!kept.some((s) => s.id === id)) {
        kept.push({
          id,
          type: 'product',
          item: it,
          duration: this.defaultSceneDuration('product', items.length)
        });
      } else {
        const sc = kept.find((s) => s.id === id);
        if (sc) sc.item = it;
      }
    });
    if (!items.length && !kept.some((s) => s.type === 'clip' || s.type === 'text')) {
      kept.push({
        id: 'empty',
        type: 'product',
        item: { name: 'Select products', price: 0, imageUrl: '', badge: '' },
        duration: this.defaultSceneDuration('product', 1)
      });
    } else if (items.length) {
      const ei = kept.findIndex((s) => s.id === 'empty');
      if (ei >= 0) kept.splice(ei, 1);
    }
    const shop = this.shopBlock();
    const introScene = intro || {
      id: 'intro',
      type: 'intro',
      title: shop.shopName,
      subtitle: this.draft.promoBadge || 'Welcome',
      duration: this.defaultSceneDuration('intro')
    };
    introScene.title = shop.shopName;
    introScene.subtitle = this.draft.promoBadge || introScene.subtitle || 'Welcome';
    const outroScene = outro || {
      id: 'outro',
      type: 'outro',
      title: 'ORDER NOW',
      duration: this.defaultSceneDuration('outro')
    };
    this.timeline = [introScene, ...kept, outroScene];
    this.ensureSceneTransitions();
  },

  ensureSceneTransitions() {
    const list = this.timeline || [];
    const defStyle = this.draft.transition || 'fade';
    list.forEach((s, i) => {
      if (i === 0) return;
      if (!s.transitionIn || typeof s.transitionIn !== 'object') {
        s.transitionIn = { style: defStyle, duration: 0.4 };
      } else {
        if (!s.transitionIn.style) s.transitionIn.style = defStyle;
        if (!(Number(s.transitionIn.duration) > 0)) s.transitionIn.duration = 0.4;
      }
    });
  },

  buildScenes() {
    const items = this.selectedItems();
    if (this.timelineManual && this.timeline?.length) {
      this.syncTimelineWithSelection(items);
    } else {
      const shop = this.shopBlock();
      const introDur = this.defaultSceneDuration('intro');
      const outroDur = this.defaultSceneDuration('outro');
      const each = this.defaultSceneDuration('product', Math.max(1, items.length));
      const clips = (this.timeline || []).filter((s) => s.type === 'clip' || s.type === 'text');
      const mid = [];
      items.forEach((it) => {
        mid.push({
          id: `item-${it.kind}-${it.id}`,
          type: 'product',
          item: it,
          duration: each,
          transitionIn: { style: this.draft.transition || 'fade', duration: 0.4 }
        });
      });
      if (!items.length) {
        mid.push({
          id: 'empty',
          type: 'product',
          item: { name: 'Select products', price: 0, imageUrl: '', badge: '' },
          duration: this.defaultSceneDuration('product', 1),
          transitionIn: { style: this.draft.transition || 'fade', duration: 0.4 }
        });
      }
      const merged = [...mid];
      clips.forEach((c) => {
        if (!merged.some((s) => s.id === c.id)) merged.push(c);
      });
      this.timeline = [{
        id: 'intro',
        type: 'intro',
        title: shop.shopName,
        subtitle: this.draft.promoBadge || 'Welcome',
        duration: introDur
      }, ...merged, {
        id: 'outro',
        type: 'outro',
        title: 'ORDER NOW',
        duration: outroDur,
        transitionIn: { style: this.draft.transition || 'fade', duration: 0.45 }
      }];
      this.ensureSceneTransitions();
    }
    this.materializeTimeline();
    return this.scenes;
  },

  addClipSceneFromFile(file, cutStart, cutEnd) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const start = Math.max(0, Number(cutStart) || 0);
      const end = Math.max(start + 0.5, Number(cutEnd) || start + 5);
      const id = `clip_${Date.now()}`;
      const scene = {
        id,
        type: 'clip',
        label: file.name || 'Uploaded clip',
        clipDataUrl: dataUrl,
        cutStart: start,
        cutEnd: end,
        duration: Math.min(30, end - start)
      };
      const list = this.timeline || [];
      const outIdx = list.findIndex((s) => s.type === 'outro');
      if (outIdx >= 0) list.splice(outIdx, 0, scene);
      else list.push(scene);
      this.timeline = list;
      this.timelineManual = true;
      this._clipVideoEls = {};
      this.materializeTimeline();
      this.refreshTimelineDom?.();
      const sc = document.getElementById('pvb-timeline');
      if (sc && !this.refreshTimelineDom) {
        sc.innerHTML = this.timelineHtml();
        this.bindTimelineDnD?.(sc);
      }
      this.drawPreviewFrame(this.previewTime || 0);
      this.toast('Clip added to timeline', 'success');
    };
    reader.onerror = () => this.toast('Could not read video file', 'error');
    reader.readAsDataURL(file);
  },

  stepsHtml() {
    const hasSel = this.selectedItems().length > 0 || this.selectedIds.size > 0 || this.selectedCombos.size > 0;
    const hasTimeline = (this.timeline?.length || this.scenes?.length) > 2;
    let step = 1;
    if (this.generatedBlob) step = 5;
    else if (hasTimeline && hasSel) step = 4;
    else if (hasSel) step = 2;
    else if (this.draft.autoCreateFlow && hasSel) step = 3;
    const labels = this.draft.autoCreateFlow
      ? ['Choose Content', 'Video Settings', 'Auto Arrange Timeline', 'Preview & Generate', 'Save & Share']
      : ['Choose Content', 'Video Settings', 'Timeline', 'Generate', 'Save & Share'];
    return `<div class="pvb-steps pvb-steps-auto">${labels.map((label, i) => {
      const n = i + 1;
      const cls = n === step ? 'active' : (n < step ? 'done' : '');
      const sep = i < labels.length - 1 ? '<span class="pvb-step-sep"></span>' : '';
      return `<span class="pvb-step ${cls}"><span class="pvb-step-num">${n < step ? '✓' : n}</span>${label}</span>${sep}`;
    }).join('')}</div>`;
  },

  paint() {
    if (!this.el) return;
    const theme = this.THEMES[this.draft.theme] || this.THEMES.red;
    const shop = this.shopBlock();
    const fmt = this.formatSize();
    this.el.innerHTML = `<div class="pvb-root" style="--pvb-accent:${theme.accent}">
      <div class="pvb-header-row">
        <div>
          <h2>Promo Video Builder</h2>
          <p class="pvb-sub">Create professional promotional videos automatically from products, combos and menus.</p>
        </div>
        <div class="pvb-header-right">
          <span class="pvb-branch-label">Branch</span>
          <select id="pvb-branch" class="pvb-select">
            <option value="all">All / shop default</option>
            ${this.branches.map((b) =>
              `<option value="${b.id}" ${String(this.branchId) === String(b.id) ? 'selected' : ''}>${this.esc(b.name)}</option>`
            ).join('')}
          </select>
          <button type="button" class="btn btn-primary" id="pvb-new">${this.mode === 'create' ? 'My Videos' : 'Create New Video'}</button>
        </div>
      </div>
      ${this.mode === 'create' ? this.stepsHtml() + this.createWorkspaceHtml(fmt, shop) : ''}
      ${this.libraryHtml()}
    </div>`;
    this.bind();
    if (this.mode === 'create') {
      this.buildScenes();
      requestAnimationFrame(() => this.drawPreviewFrame(this.previewTime || 0));
    }
  },

  createWorkspaceHtml(fmt, shop) {
    return `<div class="pvb-workspace">
      <section class="pvb-col">
        <h3>1. Choose Content</h3>
        <div class="pvb-field">
          <label>Design source</label>
          <div class="pvb-design-mode">
            <label class="pvb-radio"><input type="radio" name="pvb-design" id="pvb-design-menu" value="menu" ${this.draft.designMode === 'menu' ? 'checked' : ''}> Use Existing Menu Design</label>
            <label class="pvb-radio"><input type="radio" name="pvb-design" id="pvb-design-new" value="new" ${this.draft.designMode !== 'menu' ? 'checked' : ''}> Create New Video Design</label>
          </div>
          <p class="pvb-sub" style="margin-top:6px">${this.draft.designMode === 'menu'
            ? 'Uses Menu Builder handoff products, theme and branding when available.'
            : 'Pick products/combos below and style the video here.'}</p>
        </div>
        <div class="pvb-source-tabs">
          ${[['products', 'Products'], ['combos', 'Combos'], ['promotions', 'Promotions'], ['menus', 'Menu']].map(([id, label]) =>
            `<button type="button" class="pvb-source-tab ${this.sourceTab === id ? 'active' : ''}" data-source="${id}">${label}</button>`
          ).join('')}
        </div>
        <input type="search" class="pvb-search" id="pvb-search" placeholder="Search…" value="${this.esc(this.searchQ)}">
        <div class="pvb-list" id="pvb-list">${this.contentListHtml()}</div>
        <p class="pvb-sub" style="margin-top:8px">${this.selectedItems().length} selected · live prices from Products</p>
      </section>

      <section class="pvb-col">
        <h3>2. Video Settings</h3>
        <div class="pvb-field"><label>Video Template</label>
          <select id="pvb-template">
            ${this.TEMPLATES.map((t) =>
              `<option value="${t.id}" ${this.draft.template === t.id ? 'selected' : ''}>${this.esc(t.name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="pvb-field"><label>Video Format</label>
          <select id="pvb-format">
            ${Object.entries(this.FORMATS).map(([k, v]) =>
              `<option value="${k}" ${this.draft.format === k ? 'selected' : ''}>${this.esc(v.label)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="pvb-field"><label>Video Duration</label>
          <select id="pvb-duration">
            ${[10, 15, 20, 30, 60].map((d) =>
              `<option value="${d}" ${Number(this.draft.duration) === d ? 'selected' : ''}>${d} Seconds</option>`
            ).join('')}
            <option value="0" ${Number(this.draft.duration) === 0 ? 'selected' : ''}>Custom…</option>
          </select>
        </div>
        ${Number(this.draft.duration) === 0 ? `<div class="pvb-field"><label>Custom seconds</label>
          <input type="number" id="pvb-custom-dur" min="5" max="180" value="${Number(this.draft.customDuration) || 30}">
        </div>` : ''}
        <div class="pvb-field"><label>Default Transition</label>
          <select id="pvb-transition">
            ${(this.TRANSITION_STYLES || [
              { id: 'fade', label: 'Fade' },
              { id: 'crossfade', label: 'Crossfade' },
              { id: 'slide-left', label: 'Slide Left' },
              { id: 'slide-right', label: 'Slide Right' },
              { id: 'zoom-in', label: 'Zoom In' },
              { id: 'pop', label: 'Pop' },
              { id: 'cinematic', label: 'Cinematic' }
            ]).map((x) =>
              `<option value="${x.id}" ${this.draft.transition === x.id ? 'selected' : ''}>${x.label}</option>`
            ).join('')}
          </select>
          <span class="pvb-field-hint">Default for new scenes only. Edit each → chip on the timeline for per-gap control.</span>
        </div>
        <div class="pvb-field"><label>Promo badge</label>
          <select id="pvb-badge">
            ${this.PROMO_BADGES.map((b) =>
              `<option value="${this.esc(b)}" ${this.draft.promoBadge === b ? 'selected' : ''}>${b || '(none)'}</option>`
            ).join('')}
          </select>
        </div>
        <div class="pvb-field"><label>Theme colour</label>
          <select id="pvb-theme">
            ${Object.keys(this.THEMES).map((k) =>
              `<option value="${k}" ${this.draft.theme === k ? 'selected' : ''}>${k}</option>`
            ).join('')}
          </select>
        </div>
        <div class="pvb-field"><label>Product picture shape</label>
          <select id="pvb-img-shape">
            <option value="circle" ${this.draft.productImageShape !== 'square' ? 'selected' : ''}>Circle</option>
            <option value="square" ${this.draft.productImageShape === 'square' ? 'selected' : ''}>Square</option>
          </select>
        </div>
        <div class="pvb-field">
          <label>Music &amp; voice tracks</label>
          <div class="pvb-audio-toolbar">
            <button type="button" class="btn btn-ghost btn-sm" id="pvb-music-upload">+ Upload Music</button>
            <button type="button" class="btn btn-ghost btn-sm" id="pvb-voice-upload">+ Upload Voice</button>
            <button type="button" class="btn btn-ghost btn-sm" id="pvb-voice-record">🎤 Record Voice</button>
            <button type="button" class="btn btn-ghost btn-sm hidden" id="pvb-voice-stop">⏹ Stop Recording</button>
            <input type="file" id="pvb-music-file" accept="audio/*" multiple hidden>
            <input type="file" id="pvb-voice-file" accept="audio/*" multiple hidden>
          </div>
          ${this.toggle('pvb-fadein', 'Music fade in', this.draft.musicFadeIn !== false)}
          ${this.toggle('pvb-fadeout', 'Music fade out', this.draft.musicFadeOut !== false)}
          <div class="pvb-audio-list" id="pvb-audio-list">${this.audioTracksHtml()}</div>
          <p class="pvb-sub">Upload several tracks · trim each · set when it starts on the video · preview before use</p>
        </div>
        <div class="pvb-field">
          <label>Narrator voice (reads intro / special offer)</label>
          ${this.toggle('pvb-voice', 'Speak scene captions during preview', !!this.draft.voiceEnabled)}
          <label class="pvb-sub" style="margin-top:8px;display:block">Voice gender
            <select id="pvb-voice-gender" style="width:100%;margin-top:4px;padding:8px;border-radius:10px;border:1px solid var(--pvb-line);background:#fff">
              <option value="female" ${this.draft.voiceGender === 'female' ? 'selected' : ''}>Woman</option>
              <option value="male" ${this.draft.voiceGender === 'male' ? 'selected' : ''}>Man</option>
              <option value="auto" ${this.draft.voiceGender === 'auto' ? 'selected' : ''}>System default</option>
            </select>
          </label>
          <p class="pvb-sub">Turn off to keep the video silent (except your uploaded music / recorded voice tracks).</p>
          ${this.toggle('pvb-captions-preview', 'Show captions while editing', this.draft.captionsOnVideo !== false)}
          ${this.toggle('pvb-captions', 'Burn captions on export', this.draft.burnCaptions !== false)}
          <textarea id="pvb-voice-text" rows="2" placeholder="Optional script / caption notes…" style="width:100%;margin-top:6px;box-sizing:border-box;border-radius:10px;border:1px solid var(--pvb-line);padding:8px;font-size:13px">${this.esc(this.draft.voiceText || '')}</textarea>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="btn btn-ghost btn-sm" id="pvb-gen-caption">Generate Caption</button>
            <button type="button" class="btn btn-ghost btn-sm" id="pvb-voice-test">Test Voice</button>
          </div>
          <textarea id="pvb-promo-caption" rows="2" placeholder="Promotional caption…" style="width:100%;margin-top:6px;box-sizing:border-box;border-radius:10px;border:1px solid var(--pvb-line);padding:8px;font-size:13px">${this.esc(this.draft.promoCaption || '')}</textarea>
        </div>
        <div class="pvb-field">
          <label>Output quality</label>
          <select id="pvb-quality">
            ${[['standard', 'Standard'], ['hd', 'HD'], ['fullhd', 'Full HD'], ['hq', 'High Quality'], ['whatsapp', 'WhatsApp (compressed)'], ['tv', 'Store TV / Digital Display']].map(([v, l]) =>
              `<option value="${v}" ${this.draft.quality === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
          ${this.toggle('pvb-out-wa', 'Optimise for WhatsApp', !!this.draft.outputWhatsApp)}
          ${this.toggle('pvb-out-tv', 'Store TV mode (16:9 landscape + loop)', !!this.draft.outputTv)}
          ${this.toggle('pvb-loop', 'Loop preview', !!this.draft.loopPreview)}
        </div>
        <div class="pvb-field">
          <label>Safe area &amp; watermark</label>
          ${this.toggle('pvb-safe', 'Show safe-area guide', this.draft.safeAreaGuide)}
          ${this.toggle('pvb-watermark', 'Shop watermark', this.draft.showWatermark)}
          <input type="text" id="pvb-watermark-text" placeholder="Watermark text" value="${this.esc(this.draft.watermarkText || shop.shopName)}" style="margin-top:6px">
        </div>
        <div class="pvb-field">
          <label>End screen sizes</label>
          <div class="pvb-scale-grid">
            <label>WhatsApp text <input type="range" id="pvb-outro-contact" min="70" max="180" value="${Math.round((this.draft.outroContactScale || 1) * 100)}"><span id="pvb-outro-contact-val">${Math.round((this.draft.outroContactScale || 1) * 100)}%</span></label>
            <label>Branch / shop <input type="range" id="pvb-outro-branch" min="70" max="180" value="${Math.round((this.draft.outroBranchScale || 1) * 100)}"><span id="pvb-outro-branch-val">${Math.round((this.draft.outroBranchScale || 1) * 100)}%</span></label>
            <label>Delivery line <input type="range" id="pvb-outro-delivery" min="70" max="180" value="${Math.round((this.draft.outroDeliveryScale || 1) * 100)}"><span id="pvb-outro-delivery-val">${Math.round((this.draft.outroDeliveryScale || 1) * 100)}%</span></label>
            <label>Order online <input type="range" id="pvb-outro-order" min="70" max="180" value="${Math.round((this.draft.outroOrderScale || 1) * 100)}"><span id="pvb-outro-order-val">${Math.round((this.draft.outroOrderScale || 1) * 100)}%</span></label>
            <label>QR code size <input type="range" id="pvb-outro-qr" min="60" max="160" value="${Math.round((this.draft.outroQrScale || 1) * 100)}"><span id="pvb-outro-qr-val">${Math.round((this.draft.outroQrScale || 1) * 100)}%</span></label>
          </div>
        </div>
        <div class="pvb-field">
          <label>Branding</label>
          ${this.toggle('pvb-logo', 'Use Shop Logo', this.draft.includeLogo)}
          ${this.toggle('pvb-prices', 'Show Prices', this.draft.showPrices)}
          ${this.toggle('pvb-contact', 'Show Contact Info', this.draft.showContact)}
          ${this.toggle('pvb-delivery', 'Show Delivery Info', this.draft.showDelivery)}
          ${this.toggle('pvb-socials', 'Show Social Media', this.draft.showSocials)}
          ${this.toggle('pvb-auto-create', 'AUTO CREATE workflow', this.draft.autoCreateFlow !== false)}
        </div>
        <p class="pvb-sub">${this.esc(shop.shopName)}${shop.branchName ? ' · ' + this.esc(shop.branchName) : ''}</p>
      </section>

      <section class="pvb-col pvb-col-preview">
        <h3>3. Preview &amp; Generate</h3>
        <div class="pvb-preview-stack">
          <div class="pvb-player-shell ${fmt.cls}">
            <canvas class="pvb-canvas" id="pvb-canvas" width="${fmt.w}" height="${fmt.h}"></canvas>
            <div class="pvb-player-controls">
              <button type="button" id="pvb-play" title="Play preview">▶</button>
              <button type="button" id="pvb-stop" title="Stop">⏹</button>
              <button type="button" id="pvb-mute-audio" title="Mute / unmute music &amp; voice">${this.previewAudioMuted ? '🔇' : '🔊'}</button>
              <span class="pvb-time" id="pvb-time">0:00 / ${this.fmtTime(this.totalDuration())}</span>
            </div>
            <div class="pvb-progress"><span id="pvb-progress" style="width:${Math.round(this.generateProgress)}%"></span></div>
          </div>

          <div class="pvb-scrubber-wrap" title="Drag to scrub / seek the preview">
            <input type="range" id="pvb-seek" class="pvb-seek" min="0" max="1000" step="1"
              value="${Math.round(Math.min(1000, (this.previewTime / Math.max(0.01, this.totalDuration())) * 1000))}"
              aria-label="Scrub timeline">
            <div class="pvb-scrubber-meta">
              <span id="pvb-seek-time">${this.fmtTime(this.previewTime || 0)}</span>
              <span class="pvb-scrubber-hint">Drag to jump anywhere in the video</span>
              <span id="pvb-seek-total">${this.fmtTime(this.totalDuration())}</span>
            </div>
          </div>

          <div class="pvb-timeline-wrap">
            <div class="pvb-timeline-head">
              <strong>Timeline</strong>
              <span class="pvb-timeline-hint">${this.timelineManual ? 'Custom order' : 'Auto order'} · drag scenes to rearrange</span>
              <button type="button" class="btn btn-ghost btn-sm" id="pvb-upload-clip">+ Add My Video</button>
              <input type="file" id="pvb-clip-file" accept="video/*" hidden>
              <button type="button" class="btn btn-ghost btn-sm" id="pvb-add-text">+ Add Text</button>
              <button type="button" class="btn btn-ghost btn-sm" id="pvb-reset-transitions" title="Reset all transitions to automatic">Reset Transitions</button>
              <button type="button" class="btn btn-ghost btn-sm" id="pvb-reset-timeline">Reset order</button>
            </div>
            <div class="pvb-clip-trim">
              <label>Clip start <input type="number" id="pvb-clip-start" min="0" step="0.1" value="${Number(this.draft.clipTrimStart) || 0}"></label>
              <label>Clip end <input type="number" id="pvb-clip-end" min="0.5" step="0.1" value="${Number(this.draft.clipTrimEnd) || 5}"></label>
            </div>
            <div class="pvb-filmstrip" id="pvb-timeline">${this.timelineHtml()}</div>
          </div>

          <div class="pvb-actions">
            <button type="button" class="btn pvb-generate" id="pvb-generate">✨ Generate Final Video</button>
            <button type="button" class="btn btn-ghost" id="pvb-preview-fs">Preview Video</button>
            <button type="button" class="btn btn-ghost" id="pvb-gen-thumbs">Generate Thumbnails</button>
            <button type="button" class="btn btn-ghost" id="pvb-upload-thumb">Upload Thumbnail</button>
            <input type="file" id="pvb-thumb-file" accept="image/*" hidden>
            <button type="button" class="btn btn-ghost" id="pvb-download" ${this.generatedBlob ? '' : 'disabled'}>Download Video</button>
            <button type="button" class="btn btn-ghost" id="pvb-save" ${this.generatedBlob ? '' : 'disabled'}>Save to Library</button>
            <button type="button" class="btn btn-ghost" id="pvb-share" ${this.generatedBlob ? '' : 'disabled'}>Share WhatsApp</button>
            <button type="button" class="btn btn-primary" id="pvb-cc-share" ${this.generatedBlob ? '' : 'disabled'}>📤 Share / Publish</button>
          </div>

          <div class="pvb-thumbs-panel" id="pvb-thumbs-panel">
            ${this.thumbnailsHtml()}
          </div>
        </div>
      </section>
    </div>`;
  },

  toggle(id, label, on) {
    return `<label class="pvb-toggle-row"><span>${label}</span><input type="checkbox" id="${id}" ${on ? 'checked' : ''}></label>`;
  },

  contentListHtml() {
    if (this.productsLoading && (this.sourceTab === 'products' || this.sourceTab === 'promotions' || this.sourceTab === 'menus')) {
      return `<div class="pvb-skel"></div><div class="pvb-skel"></div><div class="pvb-skel"></div><p class="pvb-empty">Loading products…</p>`;
    }
    const q = String(this.searchQ || '').trim().toLowerCase();
    if (this.sourceTab === 'combos') {
      let list = this.combos;
      if (q) list = list.filter((c) => String(c.name || '').toLowerCase().includes(q));
      if (!list.length) return `<div class="pvb-empty">No combos found. Create combos in Combos &amp; Promos.</div>`;
      return list.slice(0, 200).map((c) => {
        const id = Number(c.id);
        const on = this.selectedCombos.has(id);
        const img = this.comboImageUrl(c);
        return `<label class="pvb-row ${on ? 'is-on' : ''}">
          <input type="checkbox" data-cid="${id}" ${on ? 'checked' : ''}>
          <span class="pvb-thumb">${img ? `<img src="${this.esc(img)}" alt="" loading="lazy">` : '🎁'}</span>
          <span class="pvb-meta"><strong>${this.esc(c.name)}</strong><small>${this.money(c.selling_price ?? c.price)}</small></span>
        </label>`;
      }).join('');
    }
    if (this.sourceTab === 'menus') {
      return `<div class="pvb-empty" style="text-align:left;padding:14px">
        <p><strong>Create Video From Menu</strong></p>
        <p>Open <em>Menu Builder</em>, select products / generate a menu, then click <strong>Create Video From Menu</strong>.</p>
        <p>Or select products here — live catalogue prices are always used.</p>
        <p style="margin-top:10px">${this.selectedIds.size} product(s) ready from menu handoff.</p>
      </div>` + this.productRowsHtml(q, true);
    }
    if (this.sourceTab === 'promotions') {
      let list = this.products.filter((p) => Number(p.is_promo) || String(p.name || '').toLowerCase().includes('special'));
      if (q) list = list.filter((p) => String(p.name || '').toLowerCase().includes(q));
      if (!list.length) {
        return `<div class="pvb-empty">No promo-flagged products. Select from Products, or mark promos in Operations.</div>`
          + this.productRowsHtml(q, false);
      }
      return list.slice(0, 200).map((p) => this.productRow(p)).join('');
    }
    return this.productRowsHtml(q, false);
  },

  productRowsHtml(q, onlySelected) {
    let list = this.products;
    if (onlySelected) list = list.filter((p) => this.selectedIds.has(Number(p.id)));
    if (q) list = list.filter((p) => {
      const name = String(p.name || '').toLowerCase();
      return name.includes(q) || String(p.sku || '').toLowerCase().includes(q);
    });
    if (!list.length) {
      if (this.productsLoading) {
        return `<div class="pvb-skel"></div><div class="pvb-skel"></div><p class="pvb-empty">Loading products…</p>`;
      }
      return this.products.length
        ? `<div class="pvb-empty">No matching products.</div>`
        : `<div class="pvb-empty">No products found. Check Operations → Products, then refresh.</div>`;
    }
    return list.slice(0, 300).map((p) => this.productRow(p)).join('');
  },

  productRow(p) {
    const id = Number(p.id);
    const on = this.selectedIds.has(id);
    const img = this.productImageUrl(p);
    return `<label class="pvb-row ${on ? 'is-on' : ''}">
      <input type="checkbox" data-pid="${id}" ${on ? 'checked' : ''}>
      <span class="pvb-thumb">${img ? `<img src="${this.esc(img)}" alt="" loading="lazy">` : '•'}</span>
      <span class="pvb-meta"><strong>${this.esc(p.name)}</strong><small>${this.money(p.selling_price)}</small></span>
    </label>`;
  },

  scenesHtml() {
    return this.timelineHtml();
  },

  timelineHtml() {
    if (!this.scenes.length && !this.timeline.length) this.buildScenes();
    this.ensureSceneTransitions?.();
    const list = this.timeline?.length ? this.timeline : this.scenes;
    const styles = this.TRANSITION_STYLES || [];
    const labelOf = (id) => (styles.find((x) => x.id === id)?.label) || id || 'Fade';
    return list.map((s, idx) => {
      const active = this.previewTime >= s.start && this.previewTime < s.end;
      const label = s.type === 'intro' ? 'Intro'
        : s.type === 'outro' ? 'End Screen'
        : s.type === 'clip' ? (s.label || 'My clip')
        : s.type === 'text' ? (s.text?.content || 'Text').slice(0, 28)
        : (s.item?.name || 'Product');
      const img = (s.type === 'clip' || s.type === 'text') ? '' : (s.item?.imageUrl || '');
      const badge = s.type === 'text' ? 'TEXT'
        : (s.item?.badge || (s.type === 'clip' ? 'CLIP' : ''));
      const durVal = (Number(s.duration) || 1).toFixed(1);
      const locked = s.type === 'intro' || s.type === 'outro';
      const empty = s.id === 'empty' || (!s.item?.name && s.type === 'product' && !s.item?.imageUrl && s.item?.name === 'Select products');
      const canPlay = s.type === 'text' ? !!(s.text?.content)
        : s.type === 'clip' ? !!(s.clipDataUrl || s.clipUrl)
        : s.type === 'intro' || s.type === 'outro' || !!(s.item?.name && s.item.name !== 'Select products');
      let html = `<div class="pvb-film-card pvb-timeline-row ${active ? 'active' : ''}" data-timeline-id="${this.esc(s.id)}" data-scene-start="${s.start}" title="${this.esc(label)}">
        <span class="pvb-timeline-grip" title="Drag">${locked ? '·' : '⋮⋮'}</span>
        <div class="pvb-film-thumb">${img ? `<img src="${this.esc(img)}" alt="">` : (s.type === 'intro' ? '★' : s.type === 'outro' ? 'QR' : s.type === 'clip' ? '🎬' : s.type === 'text' ? 'T' : '•')}</div>
        <div class="pvb-film-meta">
          <strong>${idx + 1}. ${this.esc(label.length > 22 ? `${label.slice(0, 20)}…` : label)}</strong>
          ${badge ? `<span class="pvb-scene-badge">${this.esc(badge)}</span>` : ''}
          <span>${durVal}s</span>
        </div>
        <label class="pvb-timeline-dur"><input type="number" min="0.5" max="60" step="0.5" value="${durVal}" data-scene-dur="${this.esc(s.id)}" ${locked ? 'disabled' : ''}></label>
        <div class="pvb-timeline-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-scene-play="${this.esc(s.id)}" title="Play this scene" ${canPlay ? '' : 'disabled'}>▶</button>
          ${s.type === 'text' ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-text="${this.esc(s.id)}" title="Edit text">✎</button>` : ''}
          ${s.type === 'clip' ? `<button type="button" class="btn btn-ghost btn-sm" data-cut-clip="${this.esc(s.id)}" title="Trim">✂</button>` : ''}
          ${!locked && s.id !== 'empty' ? `<button type="button" class="btn btn-ghost btn-sm" data-remove-scene="${this.esc(s.id)}" title="Remove">✕</button>` : ''}
        </div>
      </div>`;
      if (idx < list.length - 1) {
        const next = list[idx + 1];
        const tr = next.transitionIn || { style: this.draft.transition || 'fade', duration: 0.4 };
        html += `<button type="button" class="pvb-tr-chip" data-edit-transition="${this.esc(next.id)}" title="Transition into next scene">
          <span class="pvb-tr-arrow">→</span>
          <strong>${this.esc(labelOf(tr.style))}</strong>
          <em>${Number(tr.duration || 0.4).toFixed(1)}s</em>
        </button>`;
      }
      return html;
    }).join('');
  },

  thumbnailsHtml() {
    if (!this.thumbnails?.length) {
      return `<div class="pvb-thumbs-empty">
        <p><strong>Thumbnails</strong></p>
        <p>Click <em>Generate Thumbnails</em> to create options from your video scenes, or upload your own.</p>
      </div>`;
    }
    return `<div class="pvb-thumbs-head">
      <strong>Choose a thumbnail</strong>
      <span class="pvb-sub">Click to select · download the one you want</span>
    </div>
    <div class="pvb-thumbs-grid">${this.thumbnails.map((th) => `
      <div class="pvb-thumb-card ${this.selectedThumbnailId === th.id ? 'is-selected' : ''}" data-thumb-id="${this.esc(th.id)}">
        <img src="${th.dataUrl}" alt="">
        <span>${this.esc(th.label || 'Frame')}</span>
        <div class="pvb-thumb-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-use-thumb="${this.esc(th.id)}">Use</button>
          <button type="button" class="btn btn-ghost btn-sm" data-dl-thumb="${this.esc(th.id)}">Download</button>
        </div>
      </div>`).join('')}</div>`;
  },

  audioTracksHtml() {
    const tracks = this.audioTracks || [];
    if (!tracks.length) {
      return `<div class="pvb-audio-empty">No audio yet. Upload music and/or voice, or record a voice-over.</div>`;
    }
    return tracks.map((tr) => {
      const kind = tr.kind === 'voice' ? 'Voice' : 'Music';
      const dur = Number(tr.fileDuration) || 0;
      const cutEnd = tr.cutEnd != null ? Number(tr.cutEnd) : (dur || 30);
      return `<div class="pvb-audio-card" data-audio-id="${this.esc(tr.id)}">
        <div class="pvb-audio-card-top">
          <strong>${kind}: ${this.esc(tr.name || 'Track')}</strong>
          <label class="pvb-audio-on"><input type="checkbox" data-audio-on="${this.esc(tr.id)}" ${tr.enabled !== false ? 'checked' : ''}> On</label>
        </div>
        <div class="pvb-audio-row">
          <button type="button" class="btn btn-ghost btn-sm" data-audio-preview="${this.esc(tr.id)}">▶ Listen</button>
          <button type="button" class="btn btn-ghost btn-sm" data-audio-stop-prev="${this.esc(tr.id)}">⏹</button>
          ${tr.kind === 'voice' ? `<button type="button" class="btn btn-ghost btn-sm" data-audio-save="${this.esc(tr.id)}">Save voice</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-audio-del="${this.esc(tr.id)}">Remove</button>
        </div>
        <label>Volume <input type="range" min="0" max="100" value="${Math.round((tr.volume ?? 0.7) * 100)}" data-audio-vol="${this.esc(tr.id)}"></label>
        <div class="pvb-audio-trim">
          <label>Cut from <input type="number" min="0" step="0.1" value="${Number(tr.cutStart) || 0}" data-audio-cut-start="${this.esc(tr.id)}"></label>
          <label>to <input type="number" min="0.1" step="0.1" value="${cutEnd}" data-audio-cut-end="${this.esc(tr.id)}"></label>
          <label>Play at video <input type="number" min="0" step="0.1" value="${Number(tr.playAt) || 0}" data-audio-play-at="${this.esc(tr.id)}"> s</label>
        </div>
        <small class="pvb-sub">${dur ? `File length ~${dur.toFixed(1)}s` : 'Loading length…'}</small>
      </div>`;
    }).join('');
  },

  libraryHtml() {
    return `<div class="pvb-library">
      <div class="pvb-lib-head">
        <div class="pvb-lib-tabs">
          <button type="button" class="pvb-lib-tab ${this.libraryTab === 'videos' ? 'active' : ''}" data-lib="videos">My Videos</button>
          <button type="button" class="pvb-lib-tab ${this.libraryTab === 'playlists' ? 'active' : ''}" data-lib="playlists">Playlists</button>
          <button type="button" class="pvb-lib-tab ${this.libraryTab === 'campaigns' ? 'active' : ''}" data-lib="campaigns">Campaigns</button>
          <button type="button" class="pvb-lib-tab ${this.libraryTab === 'templates' ? 'active' : ''}" data-lib="templates">Video Templates</button>
          <button type="button" class="pvb-lib-tab ${this.libraryTab === 'music' ? 'active' : ''}" data-lib="music">Music Library</button>
        </div>
        <div class="pvb-lib-filters">
          <button type="button" class="btn btn-primary btn-sm" id="pvb-create-lib">Create New Video</button>
        </div>
      </div>
      ${this.libraryBodyHtml()}
    </div>`;
  },

  libraryBodyHtml() {
    if (this.libraryTab === 'templates') {
      return `<div class="pvb-template-grid">${this.TEMPLATES.map((t) =>
        `<button type="button" class="pvb-template-card ${this.draft.template === t.id ? 'active' : ''}" data-pick-template="${t.id}">
          <strong>${this.esc(t.name)}</strong><span>${this.esc(t.blurb)}</span>
        </button>`
      ).join('')}</div>`;
    }
    if (this.libraryTab === 'music') {
      if (!this.musicLibrary.length) {
        return `<div class="pvb-empty">Upload music while creating a video — saved tracks appear here.</div>`;
      }
      return `<div class="pvb-lib-grid">${this.musicLibrary.map((m) =>
        `<div class="pvb-card"><div class="pvb-card-body">
          <h4>${this.esc(m.name)}</h4>
          <p>Saved audio</p>
          <div class="pvb-card-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-use-music="${this.esc(m.id)}">Use</button>
            <button type="button" class="btn btn-ghost btn-sm" data-del-music="${this.esc(m.id)}">Delete</button>
          </div>
        </div></div>`
      ).join('')}</div>`;
    }
    if (this.libraryTab === 'playlists') {
      return typeof this.playlistsHtml === 'function' ? this.playlistsHtml() : `<div class="pvb-empty">Playlists loading…</div>`;
    }
    if (this.libraryTab === 'campaigns') {
      return typeof this.campaignsHtml === 'function' ? this.campaignsHtml() : `<div class="pvb-empty">Campaigns loading…</div>`;
    }
    if (!this.videos.length) {
      return `<div class="pvb-empty">No saved videos yet. Generate a video and click Save to Library.</div>`;
    }
    const playlists = typeof this.loadPlaylists === 'function' ? this.loadPlaylists() : [];
    return `<div class="pvb-lib-grid">${this.videos.map((v) =>
      `<div class="pvb-card" data-vid="${this.esc(v.id)}">
        <div class="pvb-card-thumb">
          ${v.poster || v.thumbnail ? `<img src="${v.poster || v.thumbnail}" alt="">` : ''}
          <span class="pvb-dur">${this.fmtTime(v.duration || 0)}</span>
        </div>
        <div class="pvb-card-body">
          <h4>${this.esc(v.title || 'Video')}</h4>
          <p>${this.esc(v.createdAt || '')}<br>${this.esc(v.branch || '')}<br>${this.esc(v.source || '')}</p>
          ${v.promoCaption ? `<p class="pvb-caption-preview">${this.esc(v.promoCaption)}</p>` : ''}
          <div class="pvb-card-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-view-vid="${this.esc(v.id)}">View</button>
            <button type="button" class="btn btn-ghost btn-sm" data-dl-vid="${this.esc(v.id)}">Download</button>
            <button type="button" class="btn btn-ghost btn-sm" data-dup-vid="${this.esc(v.id)}">Duplicate</button>
            <button type="button" class="btn btn-ghost btn-sm" data-check-vid="${this.esc(v.id)}">Check prices</button>
            ${playlists.length ? `<select data-add-pl="${this.esc(v.id)}" class="pvb-mini-select"><option value="">+ Playlist</option>${playlists.map((p) => `<option value="${this.esc(p.id)}">${this.esc(p.name)}</option>`).join('')}</select>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-del-vid="${this.esc(v.id)}">Delete</button>
          </div>
        </div>
      </div>`
    ).join('')}</div>`;
  },

  fmtTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  },

  readDraftFromDom() {
    const g = (id) => document.getElementById(id);
    if (g('pvb-template')) this.draft.template = g('pvb-template').value;
    if (g('pvb-format')) this.draft.format = g('pvb-format').value;
    if (g('pvb-duration')) this.draft.duration = Number(g('pvb-duration').value);
    if (g('pvb-custom-dur')) this.draft.customDuration = Number(g('pvb-custom-dur').value) || 30;
    if (g('pvb-transition')) this.draft.transition = g('pvb-transition').value;
    if (g('pvb-badge')) this.draft.promoBadge = g('pvb-badge').value;
    if (g('pvb-theme')) this.draft.theme = g('pvb-theme').value;
    if (g('pvb-volume')) this.draft.musicVolume = (Number(g('pvb-volume').value) || 70) / 100;
    if (g('pvb-quality')) this.draft.quality = g('pvb-quality').value;
    if (g('pvb-watermark-text')) this.draft.watermarkText = g('pvb-watermark-text').value || '';
    if (g('pvb-theme')) this.draft.theme = g('pvb-theme').value;
    if (g('pvb-img-shape')) this.draft.productImageShape = g('pvb-img-shape').value || 'circle';
    if (g('pvb-voice-text')) this.draft.voiceText = g('pvb-voice-text').value || '';
    if (g('pvb-promo-caption')) this.draft.promoCaption = g('pvb-promo-caption').value || '';
    if (g('pvb-voice-gender')) this.draft.voiceGender = g('pvb-voice-gender').value || 'female';
    if (g('pvb-clip-start')) this.draft.clipTrimStart = Number(g('pvb-clip-start').value) || 0;
    if (g('pvb-clip-end')) this.draft.clipTrimEnd = Number(g('pvb-clip-end').value) || 5;
    if (g('pvb-outro-contact')) this.draft.outroContactScale = (Number(g('pvb-outro-contact').value) || 100) / 100;
    if (g('pvb-outro-branch')) this.draft.outroBranchScale = (Number(g('pvb-outro-branch').value) || 100) / 100;
    if (g('pvb-outro-delivery')) this.draft.outroDeliveryScale = (Number(g('pvb-outro-delivery').value) || 100) / 100;
    if (g('pvb-outro-order')) this.draft.outroOrderScale = (Number(g('pvb-outro-order').value) || 100) / 100;
    if (g('pvb-outro-qr')) this.draft.outroQrScale = (Number(g('pvb-outro-qr').value) || 100) / 100;
    if (g('pvb-design-menu')?.checked) this.draft.designMode = 'menu';
    else if (g('pvb-design-new')?.checked) this.draft.designMode = 'new';
    const map = [
      ['pvb-logo', 'includeLogo'], ['pvb-prices', 'showPrices'], ['pvb-contact', 'showContact'],
      ['pvb-delivery', 'showDelivery'], ['pvb-socials', 'showSocials'],
      ['pvb-fadein', 'musicFadeIn'], ['pvb-fadeout', 'musicFadeOut'],
      ['pvb-out-wa', 'outputWhatsApp'], ['pvb-out-tv', 'outputTv'],
      ['pvb-loop', 'loopPreview'],
      ['pvb-voice', 'voiceEnabled'],
      ['pvb-captions-preview', 'captionsOnVideo'],
      ['pvb-captions', 'burnCaptions'], ['pvb-safe', 'safeAreaGuide'],
      ['pvb-watermark', 'showWatermark'], ['pvb-auto-create', 'autoCreateFlow']
    ];
    map.forEach(([id, key]) => { const el = g(id); if (el) this.draft[key] = !!el.checked; });
    // Keep preview TTS in sync with the master narrator switch
    this.draft.voicePreview = !!this.draft.voiceEnabled;
  },

  bind() {
    document.getElementById('pvb-branch')?.addEventListener('change', (e) => {
      this.branchId = e.target.value || 'all';
      this.buildScenes();
      this.drawPreviewFrame(0);
    });
    document.getElementById('pvb-new')?.addEventListener('click', () => {
      this.mode = this.mode === 'create' ? 'library' : 'create';
      if (this.mode === 'create') this.libraryTab = 'videos';
      this.paint();
    });
    document.getElementById('pvb-create-lib')?.addEventListener('click', () => {
      this.mode = 'create';
      this.paint();
    });
    this.el?.querySelectorAll('[data-source]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.readDraftFromDom();
        this.sourceTab = btn.dataset.source;
        this.paint();
      });
    });
    this.el?.querySelectorAll('[data-lib]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.libraryTab = btn.dataset.lib;
        this.paint();
      });
    });
    document.getElementById('pvb-search')?.addEventListener('input', (e) => {
      this.searchQ = e.target.value || '';
      const list = document.getElementById('pvb-list');
      if (list) list.innerHTML = this.contentListHtml();
      this.bindListChecks();
    });
    this.bindListChecks();

    ['pvb-template', 'pvb-format', 'pvb-duration', 'pvb-transition', 'pvb-badge', 'pvb-theme', 'pvb-custom-dur', 'pvb-quality', 'pvb-voice-gender', 'pvb-img-shape'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.readDraftFromDom();
        if (id === 'pvb-voice-gender') return;
        if (id === 'pvb-img-shape') {
          this.drawPreviewFrame(this.previewTime || 0);
          return;
        }
        this.buildScenes();
        this.paint();
      });
    });
    document.getElementById('pvb-voice')?.addEventListener('change', () => {
      this.readDraftFromDom();
      if (!this.draft.voiceEnabled) this.stopVoicePreview?.();
    });
    document.getElementById('pvb-volume')?.addEventListener('input', () => this.readDraftFromDom());

    document.getElementById('pvb-music-upload')?.addEventListener('click', () => document.getElementById('pvb-music-file')?.click());
    document.getElementById('pvb-voice-upload')?.addEventListener('click', () => document.getElementById('pvb-voice-file')?.click());
    document.getElementById('pvb-music-file')?.addEventListener('change', (e) => {
      this.addAudioFiles?.(e.target.files, 'music');
      e.target.value = '';
    });
    document.getElementById('pvb-voice-file')?.addEventListener('change', (e) => {
      this.addAudioFiles?.(e.target.files, 'voice');
      e.target.value = '';
    });
    document.getElementById('pvb-voice-record')?.addEventListener('click', () => this.startVoiceRecording?.());
    document.getElementById('pvb-voice-stop')?.addEventListener('click', () => this.stopVoiceRecording?.());
    this.migrateLegacyMusicToTracks?.();
    this.bindAudioTrackControls?.();
    document.getElementById('pvb-mute-audio')?.addEventListener('click', () => {
      this.setPreviewMixMuted?.(!this.previewAudioMuted);
    });

    document.getElementById('pvb-play')?.addEventListener('click', () => this.togglePreview());
    document.getElementById('pvb-stop')?.addEventListener('click', () => this.stopPreview({ reset: true }));
    this.bindScrubber?.();
    document.getElementById('pvb-captions-preview')?.addEventListener('change', () => {
      this.readDraftFromDom();
      this.drawPreviewFrame(this.previewTime || 0);
    });
    document.getElementById('pvb-generate')?.addEventListener('click', () => this.generateVideo());
    document.getElementById('pvb-preview-fs')?.addEventListener('click', () => this.previewFullscreen());
    document.getElementById('pvb-download')?.addEventListener('click', () => this.downloadGenerated());
    document.getElementById('pvb-save')?.addEventListener('click', () => this.saveToLibrary());
    document.getElementById('pvb-share')?.addEventListener('click', () => this.shareWhatsApp());
    document.getElementById('pvb-cc-share')?.addEventListener('click', () => this.sharePublishCC());
    document.getElementById('pvb-voice-test')?.addEventListener('click', () => {
      this.readDraftFromDom();
      this.voicePreviewFull?.();
    });
    document.getElementById('pvb-gen-caption')?.addEventListener('click', () => {
      this.readDraftFromDom();
      if (typeof this.buildPromoCaption === 'function') {
        this.draft.promoCaption = this.buildPromoCaption();
      } else {
        const items = this.selectedItems().slice(0, 4).map((i) => i.name).join(', ');
        const shop = this.shopBlock();
        this.draft.promoCaption = `${shop.shopName}: ${this.draft.promoBadge || 'Special'} — ${items}${items ? '.' : ''} Order now!`;
      }
      const el = document.getElementById('pvb-promo-caption');
      if (el) el.value = this.draft.promoCaption;
      this.toast('Caption generated', 'success');
    });
    document.getElementById('pvb-gen-thumbs')?.addEventListener('click', () => this.generateThumbnails());
    document.getElementById('pvb-upload-thumb')?.addEventListener('click', () => document.getElementById('pvb-thumb-file')?.click());
    document.getElementById('pvb-thumb-file')?.addEventListener('change', (e) => this.onThumbnailUpload(e));
    this.bindThumbnailActions();
    ['pvb-outro-contact', 'pvb-outro-branch', 'pvb-outro-delivery', 'pvb-outro-order', 'pvb-outro-qr'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const apply = () => {
        this.readDraftFromDom();
        const valEl = document.getElementById(`${id}-val`);
        if (valEl) valEl.textContent = `${el.value}%`;
        // Jump preview to outro so size changes are visible
        const outro = (this.scenes || []).find((s) => s.type === 'outro');
        if (outro) {
          this.previewTime = outro.start + outro.duration * 0.4;
          this.drawPreviewFrame(this.previewTime);
        }
      };
      el.addEventListener('input', apply);
    });
    document.getElementById('pvb-design-menu')?.addEventListener('change', () => {
      this.draft.designMode = 'menu';
      this.sourceTab = 'menus';
      this.paint();
    });
    document.getElementById('pvb-design-new')?.addEventListener('change', () => {
      this.draft.designMode = 'new';
      this.paint();
    });
    document.getElementById('pvb-upload-clip')?.addEventListener('click', () => document.getElementById('pvb-clip-file')?.click());
    document.getElementById('pvb-clip-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this.readDraftFromDom();
      const start = Number(this.draft.clipTrimStart) || 0;
      const end = Number(this.draft.clipTrimEnd) || Math.max(start + 1, 5);
      this.addClipSceneFromFile(file, start, end);
      e.target.value = '';
    });
    document.getElementById('pvb-reset-timeline')?.addEventListener('click', () => {
      this.timelineManual = false;
      this.buildScenes();
      this.refreshTimelineDom?.();
      const sc = document.getElementById('pvb-timeline');
      if (sc && !this.refreshTimelineDom) {
        sc.innerHTML = this.timelineHtml();
        this.bindTimelineDnD?.(sc);
      }
      this.toast('Timeline reset to auto order', 'info');
    });
    document.getElementById('pvb-add-text')?.addEventListener('click', () => this.openTextSceneEditor?.());
    document.getElementById('pvb-reset-transitions')?.addEventListener('click', () => this.resetTransitionsToAutomatic?.());
    const tl = document.getElementById('pvb-timeline');
    if (tl) this.bindTimelineDnD?.(tl);
    this.bindLibraryExtra?.();

    this.el?.querySelectorAll('[data-pick-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.draft.template = btn.dataset.pickTemplate;
        this.mode = 'create';
        this.paint();
      });
    });
    this.el?.querySelectorAll('[data-use-music]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const m = this.musicLibrary.find((x) => x.id === btn.dataset.useMusic);
        if (!m) return;
        if (!(this.audioTracks || []).some((t) => t.id === m.id)) {
          this.audioTracks = this.audioTracks || [];
          this.audioTracks.push({
            id: m.id,
            kind: 'music',
            name: m.name,
            dataUrl: m.dataUrl,
            volume: 0.7,
            enabled: true,
            cutStart: 0,
            cutEnd: null,
            playAt: 0,
            fileDuration: 0
          });
          await this.probeTrackDuration?.(this.audioTracks[this.audioTracks.length - 1]);
        }
        this.draft.musicId = m.id;
        this.draft.musicName = m.name;
        this.draft.musicDataUrl = m.dataUrl;
        this.mode = 'create';
        this.toast('Music added to tracks', 'success');
        this.paint();
      });
    });
    this.el?.querySelectorAll('[data-del-music]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.musicLibrary = this.musicLibrary.filter((x) => x.id !== btn.dataset.delMusic);
        this.saveMusic();
        this.paint();
      });
    });
    this.el?.querySelectorAll('[data-del-vid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.videos = this.videos.filter((x) => x.id !== btn.dataset.delVid);
        this.saveVideos();
        this.paint();
      });
    });
    this.el?.querySelectorAll('[data-dl-vid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = this.videos.find((x) => x.id === btn.dataset.dlVid);
        if (!v?.dataUrl) return this.toast('Video data missing — regenerate', 'error');
        const a = document.createElement('a');
        a.href = v.dataUrl;
        a.download = `${(v.title || 'promo').replace(/\W+/g, '-')}.webm`;
        a.click();
      });
    });
    this.el?.querySelectorAll('[data-view-vid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = this.videos.find((x) => x.id === btn.dataset.viewVid);
        if (!v?.dataUrl) return;
        window.open(v.dataUrl, '_blank');
      });
    });
    this.el?.querySelectorAll('[data-dup-vid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof this.duplicateVideo === 'function') this.duplicateVideo(btn.dataset.dupVid);
        else {
          const v = this.videos.find((x) => x.id === btn.dataset.dupVid);
          if (!v) return;
          this.videos.unshift({ ...v, id: `vid_${Date.now()}`, title: `${v.title} (copy)`, createdAt: new Date().toLocaleString() });
          this.saveVideos();
          this.toast('Duplicated', 'success');
          this.paint();
        }
      });
    });
  },

  bindListChecks() {
    this.el?.querySelectorAll('#pvb-list input[data-pid]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = Number(inp.dataset.pid);
        if (inp.checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.draft.sourceLabel = 'Products';
        if (!this.timelineManual) this.buildScenes();
        else this.syncTimelineWithSelection(this.selectedItems());
        this.materializeTimeline();
        this.refreshTimelineDom?.();
        const sc = document.getElementById('pvb-timeline');
        if (sc && !this.refreshTimelineDom) {
          sc.innerHTML = this.timelineHtml();
          this.bindTimelineDnD?.(sc);
        }
        this.drawPreviewFrame(0);
        inp.closest('.pvb-row')?.classList.toggle('is-on', inp.checked);
      });
    });
    this.el?.querySelectorAll('#pvb-list input[data-cid]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = Number(inp.dataset.cid);
        if (inp.checked) this.selectedCombos.add(id);
        else this.selectedCombos.delete(id);
        this.draft.sourceLabel = 'Combos';
        if (!this.timelineManual) this.buildScenes();
        else this.syncTimelineWithSelection(this.selectedItems());
        this.materializeTimeline();
        this.refreshTimelineDom?.();
        this.drawPreviewFrame(0);
      });
    });
  },

  async onMusicFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      this._musicBlob = file;
      this._musicArrayBuffer = await file.arrayBuffer();
      const dataUrl = await this.blobToDataUrl(file);
      const id = `music_${Date.now()}`;
      this.draft.musicDataUrl = dataUrl;
      this.draft.musicName = file.name;
      this.draft.musicId = id;
      this.musicLibrary.unshift({ id, name: file.name, dataUrl });
      this.saveMusic();
      this.toast('Music ready', 'success');
      this.paint();
    } catch (err) {
      console.warn(err);
      this.toast('Could not load music file', 'error');
    }
  },

  async prepareMusicBuffer(dataUrl) {
    if (this._musicArrayBuffer && this._musicArrayBuffer.byteLength) {
      return this._musicArrayBuffer.slice(0);
    }
    if (this._musicBlob) {
      this._musicArrayBuffer = await this._musicBlob.arrayBuffer();
      return this._musicArrayBuffer.slice(0);
    }
    const src = dataUrl || this.draft.musicDataUrl;
    if (!src) return null;
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      const b64 = comma >= 0 ? src.slice(comma + 1) : src;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this._musicArrayBuffer = bytes.buffer;
      return this._musicArrayBuffer.slice(0);
    }
    const res = await fetch(src);
    this._musicArrayBuffer = await res.arrayBuffer();
    return this._musicArrayBuffer.slice(0);
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

  ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  },

  async ensureAssets() {
    const shop = this.shopBlock();
    this._logoImg = this.draft.includeLogo ? await this.loadImage(shop.logoUrl) : null;
    const items = this.selectedItems();
    this._itemImgs = {};
    await Promise.all(items.map(async (it) => {
      this._itemImgs[`${it.kind}-${it.id}`] = await this.loadImage(it.imageUrl);
    }));
    const clips = (this.timeline || this.scenes || []).filter((s) => s.type === 'clip');
    await Promise.all(clips.map(async (s) => {
      if (typeof this.ensureClipVideo === 'function') await this.ensureClipVideo(s);
    }));
    if (shop.orderUrl) {
      this._qrImg = await this.loadQrImage(shop.orderUrl);
    } else {
      this._qrImg = null;
    }
  },

  drawPreviewFrame(t) {
    const canvas = document.getElementById('pvb-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    this.renderFrame(ctx, canvas.width, canvas.height, t);
    const timeEl = document.getElementById('pvb-time');
    if (timeEl) timeEl.textContent = `${this.fmtTime(t)} / ${this.fmtTime(this.totalDuration())}`;
    const liveTime = document.getElementById('pvb-live-time');
    if (liveTime) liveTime.textContent = `${this.fmtTime(t)} / ${this.fmtTime(this.totalDuration())}`;
    this.syncScrubber?.(t);
    if (this._previewOverlayCanvas) {
      try {
        const octx = this._previewOverlayCanvas.getContext('2d');
        octx.drawImage(canvas, 0, 0, this._previewOverlayCanvas.width, this._previewOverlayCanvas.height);
      } catch (_) { /* */ }
    }
  },

  syncScrubber(t) {
    const total = Math.max(0.01, this.totalDuration());
    const seek = document.getElementById('pvb-seek');
    if (seek && !seek.matches(':active') && document.activeElement !== seek) {
      seek.value = String(Math.round(Math.min(1000, Math.max(0, (Number(t) || 0) / total) * 1000)));
    }
    const st = document.getElementById('pvb-seek-time');
    if (st) st.textContent = this.fmtTime(t || 0);
    const tot = document.getElementById('pvb-seek-total');
    if (tot) tot.textContent = this.fmtTime(total);
  },

  seekPreviewTo(ratioOrSec, asRatio) {
    const total = Math.max(0.01, this.totalDuration());
    let t;
    if (asRatio) t = Math.max(0, Math.min(total - 0.001, (Number(ratioOrSec) || 0) * total));
    else t = Math.max(0, Math.min(total - 0.001, Number(ratioOrSec) || 0));
    const wasPlaying = this.previewPlaying;
    if (wasPlaying) this.stopPreview({ keepTime: true });
    this.previewTime = t;
    this.drawPreviewFrame(t);
    document.querySelectorAll('#pvb-timeline .pvb-timeline-row').forEach((row) => {
      const id = row.dataset.timelineId;
      const scn = this.scenes.find((s) => s.id === id);
      row.classList.toggle('active', !!(scn && t >= scn.start && t < scn.end));
    });
    if (wasPlaying) this.togglePreview({ from: t });
  },

  bindScrubber() {
    const seek = document.getElementById('pvb-seek');
    if (!seek || seek.dataset.bound === '1') return;
    seek.dataset.bound = '1';
    const onSeek = () => {
      const ratio = (Number(seek.value) || 0) / 1000;
      this.seekPreviewTo(ratio, true);
    };
    seek.addEventListener('input', onSeek);
    seek.addEventListener('change', onSeek);
  },

  transitionMix(localT, duration, style, edgeSec) {
    const edge = Math.max(0.12, Math.min(Number(edgeSec) || 0.45, duration * 0.45));
    const st = String(style || 'fade');
    if (localT < edge) {
      const p = this.ease(localT / edge);
      return this.transitionTransform(st, p, 'in');
    }
    if (localT > duration - edge) {
      const p = this.ease((duration - localT) / edge);
      return this.transitionTransform(st, p, 'out');
    }
    return { alpha: 1, slideX: 0, slideY: 0, scale: 1, wipe: 0 };
  },

  transitionTransform(style, p, dir) {
    const incoming = dir === 'in';
    const a = p;
    const base = { alpha: a, slideX: 0, slideY: 0, scale: 1, wipe: 0 };
    switch (style) {
      case 'slide':
      case 'slide-left':
        return { ...base, slideX: incoming ? (1 - p) * 120 : -(1 - p) * 120 };
      case 'slide-right':
        return { ...base, slideX: incoming ? -(1 - p) * 120 : (1 - p) * 120 };
      case 'slide-up':
        return { ...base, slideY: incoming ? (1 - p) * 100 : -(1 - p) * 100 };
      case 'slide-down':
        return { ...base, slideY: incoming ? -(1 - p) * 100 : (1 - p) * 100 };
      case 'push':
        return { ...base, slideX: incoming ? (1 - p) * 160 : -(1 - p) * 160 };
      case 'zoom':
      case 'zoom-in':
        return { ...base, scale: incoming ? 0.82 + 0.18 * p : 1 + (1 - p) * 0.12 };
      case 'zoom-out':
        return { ...base, scale: incoming ? 1.18 - 0.18 * p : 1 - (1 - p) * 0.1 };
      case 'pop':
        return { ...base, scale: incoming ? 0.7 + 0.3 * p : 1 };
      case 'wipe':
        return { ...base, wipe: incoming ? p : 1 - (1 - p), alpha: 1 };
      case 'dissolve':
      case 'crossfade':
      case 'fade':
      case 'cinematic':
      case 'swipe':
      default:
        return { ...base, slideX: style === 'swipe' ? (incoming ? (1 - p) * 80 : -(1 - p) * 80) : 0 };
    }
  },

  getIncomingTransition(scene) {
    const tr = scene?.transitionIn;
    return {
      style: tr?.style || this.draft.transition || 'fade',
      duration: Math.max(0.15, Math.min(2.5, Number(tr?.duration) || 0.4))
    };
  },

  paintSceneContent(ctx, W, H, t, shop, scene, local, dur, isLand, isSquare) {
    if (scene?.type === 'intro') this.paintIntro(ctx, W, H, t, shop, local, dur, isLand);
    else if (scene?.type === 'outro') this.paintOutro(ctx, W, H, t, shop, local, dur, isLand);
    else if (scene?.type === 'clip') this.paintClipScene?.(ctx, W, H, scene, local);
    else if (scene?.type === 'text') this.paintTextScene?.(ctx, W, H, t, scene, local, dur);
    else if (this.draft.template === 'buyget' && typeof this.paintBuyGetScene === 'function') {
      this.paintBuyGetScene(ctx, W, H, t, shop, scene, local, dur, isLand);
    } else this.paintProductScene(ctx, W, H, t, shop, scene, local, dur, isLand, isSquare);
  },

  renderFrame(ctx, W, H, tSec) {
    const t = this.THEMES[this.draft.theme] || this.THEMES.red;
    const shop = this.shopBlock();
    const total = this.totalDuration();
    const time = Math.max(0, Math.min(total - 0.001, tSec));
    const sceneIdx = this.scenes.findIndex((s) => time >= s.start && time < s.end);
    const scene = (sceneIdx >= 0 ? this.scenes[sceneIdx] : this.scenes[this.scenes.length - 1]) || null;
    const prev = sceneIdx > 0 ? this.scenes[sceneIdx - 1] : null;
    const next = sceneIdx >= 0 && sceneIdx < this.scenes.length - 1 ? this.scenes[sceneIdx + 1] : null;
    const local = time - (scene?.start || 0);
    const dur = scene?.duration || 1;
    const trIn = this.getIncomingTransition(scene);
    const trOut = next ? this.getIncomingTransition(next) : { style: this.draft.transition || 'fade', duration: 0.35 };
    const mixIn = this.transitionMix(local, dur, trIn.style, trIn.duration);
    // Outgoing uses next transition style near end
    let mix = mixIn;
    if (local > dur - trOut.duration) {
      mix = this.transitionMix(local, dur, trOut.style, trOut.duration);
    }
    const isLand = W > H;
    const isSquare = Math.abs(W - H) < 2;

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.bg);
    g.addColorStop(0.55, t.card);
    g.addColorStop(1, t.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, W, H * 0.08);
    ctx.fillRect(0, H * 0.92, W, H * 0.08);

    // Crossfade / dissolve: draw previous scene under current during intro edge
    const inEdge = Math.max(0.12, Math.min(trIn.duration, dur * 0.45));
    if (prev && local < inEdge && (trIn.style === 'crossfade' || trIn.style === 'dissolve')) {
      const p = this.ease(local / inEdge);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      this.paintSceneContent(ctx, W, H, t, shop, prev, prev.duration - 0.01, prev.duration, isLand, isSquare);
      ctx.restore();
    }

    ctx.save();
    if (mix.wipe > 0 && mix.wipe < 1 && String(trIn.style) === 'wipe' && local < inEdge) {
      ctx.beginPath();
      ctx.rect(0, 0, W * mix.wipe, H);
      ctx.clip();
    }
    ctx.globalAlpha = mix.alpha;
    ctx.translate(mix.slideX || 0, mix.slideY || 0);
    ctx.translate(W / 2, H / 2);
    ctx.scale(mix.scale || 1, mix.scale || 1);
    ctx.translate(-W / 2, -H / 2);

    this.paintSceneContent(ctx, W, H, t, shop, scene, local, dur, isLand, isSquare);
    ctx.restore();

    this.paintSceneCaption?.(ctx, W, H, scene, local);
    this.paintSafeAreaOverlay?.(ctx, W, H);
    this.paintWatermark?.(ctx, W, H, shop);

    if (this.draft.includeLogo && this._logoImg && scene?.type === 'product') {
      const s = Math.round(Math.min(W, H) * 0.07);
      ctx.save();
      ctx.beginPath();
      ctx.arc(W * 0.08, H * 0.07, s / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      this.drawCover(ctx, this._logoImg, W * 0.08 - s / 2, H * 0.07 - s / 2, s, s);
      ctx.restore();
    }
  },

  paintIntro(ctx, W, H, t, shop, local, dur, isLand) {
    const land = isLand || W > H;
    const short = Math.min(W, H);
    const p = Math.min(1, local / Math.min(1.2, dur * 0.4));
    const ep = this.ease(p);
    const logoS = Math.round(short * (land ? 0.28 : 0.22) * (0.92 + 0.08 * ep));
    const logoY = land ? H * 0.18 : H * 0.22;
    let cursorY = logoY;

    if (this._logoImg) {
      const x = (W - logoS) / 2;
      const y = logoY - (1 - ep) * (land ? 24 : 40);
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, y + logoS / 2, logoS / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      this.drawCover(ctx, this._logoImg, x, y, logoS, logoS);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(3, short * 0.006);
      ctx.beginPath();
      ctx.arc(W / 2, y + logoS / 2, logoS / 2, 0, Math.PI * 2);
      ctx.stroke();
      cursorY = y + logoS + (land ? H * 0.06 : H * 0.05);
    } else {
      cursorY = land ? H * 0.38 : H * 0.42;
    }

    ctx.globalAlpha = ep;
    ctx.fillStyle = t.text;
    ctx.textAlign = 'center';
    const nameSize = Math.round(short * (land ? 0.07 : 0.055));
    ctx.font = `bold ${nameSize}px system-ui,Segoe UI,sans-serif`;
    ctx.fillText(shop.shopName || 'Welcome', W / 2, cursorY + nameSize * 0.35);
    cursorY += nameSize + (land ? H * 0.05 : H * 0.04);

    if (this.draft.promoBadge) {
      ctx.font = `bold ${Math.round(short * 0.032)}px system-ui,Segoe UI,sans-serif`;
      const tw = ctx.measureText(this.draft.promoBadge).width + Math.round(short * 0.06);
      const bh = Math.round(short * 0.055);
      ctx.fillStyle = t.accent;
      this.roundRect(ctx, (W - tw) / 2, cursorY, tw, bh, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(this.draft.promoBadge, W / 2, cursorY + bh * 0.68);
      cursorY += bh + (land ? H * 0.04 : H * 0.035);
    }

    if (shop.branchName) {
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(short * 0.028)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(shop.branchName, W / 2, cursorY);
    }
    ctx.globalAlpha = 1;
  },

  paintProductScene(ctx, W, H, t, shop, scene, local, dur, isLand) {
    const item = scene?.item || {};
    const key = `${item.kind}-${item.id}`;
    const img = this._itemImgs?.[key];
    const land = isLand || W > H;
    const short = Math.min(W, H);
    const ken = 1 + 0.06 * Math.sin((local / Math.max(0.1, dur)) * Math.PI);
    const shape = String(this.draft.productImageShape || 'circle');
    const imgBox = land
      ? { x: W * 0.05, y: H * 0.1, w: W * 0.4, h: H * 0.8 }
      : { x: W * 0.1, y: H * 0.12, w: W * 0.8, h: H * 0.4 };

    // Image frame
    const pad = Math.round(short * 0.012);
    const ix = imgBox.x + pad;
    const iy = imgBox.y + pad;
    const iw = imgBox.w - pad * 2;
    const ih = imgBox.h - pad * 2;
    const side = land ? Math.min(iw, ih) : Math.min(iw, ih);
    const drawX = land ? ix + (iw - side) / 2 : ix + (iw - side) / 2;
    const drawY = land ? iy + (ih - side) / 2 : iy;
    const drawS = land ? side : Math.min(iw, ih * 0.95);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    this.roundRect(ctx, imgBox.x, imgBox.y, imgBox.w, imgBox.h, 24);
    ctx.fill();

    ctx.save();
    if (shape === 'square') {
      this.roundRect(ctx, drawX, drawY, drawS, drawS, Math.round(short * 0.03));
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.arc(drawX + drawS / 2, drawY + drawS / 2, drawS / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    if (img) {
      const cx = drawX + drawS / 2;
      const cy = drawY + drawS / 2;
      ctx.translate(cx, cy);
      ctx.scale(ken, ken);
      ctx.translate(-cx, -cy);
      this.drawCover(ctx, img, drawX, drawY, drawS, drawS);
    } else {
      ctx.fillStyle = '#334155';
      ctx.fillRect(drawX, drawY, drawS, drawS);
    }
    ctx.restore();

    // Soft ring for circle
    if (shape !== 'square') {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(3, short * 0.006);
      ctx.beginPath();
      ctx.arc(drawX + drawS / 2, drawY + drawS / 2, drawS / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    const nameAppear = this.ease(Math.min(1, Math.max(0, (local - 0.12) / 0.4)));
    const priceAppear = this.ease(Math.min(1, Math.max(0, (local - 0.4) / 0.35)));
    const textX = land ? W * 0.52 : W / 2;
    const textAlign = land ? 'left' : 'center';
    const textMaxW = land ? W * 0.42 : W * 0.86;
    ctx.textAlign = textAlign;

    let ty = land ? H * 0.22 : H * 0.58;

    // Badge / special offer
    const badge = item.badge || this.draft.promoBadge || '';
    if (badge) {
      ctx.globalAlpha = nameAppear;
      ctx.fillStyle = t.gold;
      ctx.font = `bold ${Math.round(short * 0.032)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(String(badge).toUpperCase(), textX, ty);
      ty += short * 0.055;
    }

    // Product / combo name
    ctx.globalAlpha = nameAppear;
    ctx.fillStyle = t.text;
    ctx.font = `bold ${Math.round(short * (land ? 0.065 : 0.055))}px system-ui,Segoe UI,sans-serif`;
    const nameLine = Math.round(short * 0.06);
    this.wrapFill(ctx, String(item.name || 'Item').toUpperCase(), textX, ty, textMaxW, nameLine, land ? 2 : 2);
    ty += nameLine * 2.1;

    // Description
    const desc = String(item.description || '').trim();
    if (desc) {
      ctx.globalAlpha = nameAppear * 0.95;
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(short * 0.028)}px system-ui,Segoe UI,sans-serif`;
      const dLine = Math.round(short * 0.036);
      this.wrapFill(ctx, desc, textX, ty, textMaxW, dLine, land ? 3 : 2);
      ty += dLine * (land ? 3.2 : 2.4);
    } else {
      ty += short * 0.02;
    }

    // Price block — sits cleanly on its own row
    if (this.draft.showPrices !== false) {
      ctx.globalAlpha = priceAppear;
      const wn = this.itemWasNow?.(item);
      if (wn && typeof this.paintWasNow === 'function') {
        this.paintWasNow(ctx, W, H, item, textX, ty, textAlign);
      } else {
        const price = this.money(item.price).replace(/\.00$/, '');
        ctx.font = `bold ${Math.round(short * 0.05)}px system-ui,Segoe UI,sans-serif`;
        const pw = Math.max(short * 0.28, ctx.measureText(price).width + short * 0.08);
        const ph = Math.round(short * 0.09);
        const px = land ? textX : (W - pw) / 2;
        const py = Math.min(ty, H * 0.86 - ph);
        ctx.fillStyle = t.accent;
        this.roundRect(ctx, px, py, pw, ph, 14);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = land ? 'left' : 'center';
        ctx.fillText(price, land ? px + short * 0.035 : W / 2, py + ph * 0.68);
      }
    }
    ctx.globalAlpha = 1;
  },

  paintOutro(ctx, W, H, t, shop, local, dur, isLand) {
    const land = isLand || W > H;
    const short = Math.min(W, H);
    const p = this.ease(Math.min(1, local / Math.min(1, dur * 0.35)));
    const scContact = Math.max(0.6, Math.min(1.9, Number(this.draft.outroContactScale) || 1));
    const scBranch = Math.max(0.6, Math.min(1.9, Number(this.draft.outroBranchScale) || 1));
    const scDelivery = Math.max(0.6, Math.min(1.9, Number(this.draft.outroDeliveryScale) || 1));
    const scOrder = Math.max(0.6, Math.min(1.9, Number(this.draft.outroOrderScale) || 1));
    const scQr = Math.max(0.55, Math.min(1.7, Number(this.draft.outroQrScale) || 1));
    ctx.globalAlpha = p;
    ctx.textAlign = 'center';

    if (land) {
      // Landscape: left copy column · right QR — no stacking collisions
      let leftY = H * 0.12;
      if (this.draft.includeLogo && this._logoImg) {
        const s = Math.round(short * 0.16);
        const x = W * 0.08;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + s / 2, leftY + s / 2, s / 2, 0, Math.PI * 2);
        ctx.clip();
        this.drawCover(ctx, this._logoImg, x, leftY, s, s);
        ctx.restore();
        leftY += s + H * 0.05;
      }

      const bannerH = Math.round(short * 0.07);
      const bannerW = W * 0.42;
      ctx.fillStyle = t.accent;
      this.roundRect(ctx, W * 0.06, leftY, bannerW, bannerH, 14);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(short * 0.04)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('ORDER NOW', W * 0.06 + short * 0.03, leftY + bannerH * 0.68);
      leftY += bannerH + H * 0.06;

      ctx.textAlign = 'left';
      const lx = W * 0.08;
      if (this.draft.showContact && shop.phone) {
        ctx.fillStyle = t.text;
        ctx.font = `bold ${Math.round(short * 0.032 * scContact)}px system-ui,Segoe UI,sans-serif`;
        ctx.fillText(`WhatsApp ${shop.phone}`, lx, leftY);
        leftY += H * 0.07 * scContact;
      }
      if (shop.branchName || shop.address) {
        ctx.fillStyle = t.muted;
        ctx.font = `${Math.round(short * 0.028 * scBranch)}px system-ui,Segoe UI,sans-serif`;
        ctx.fillText(shop.branchName || shop.address, lx, leftY);
        leftY += H * 0.06 * scBranch;
      }
      if (this.draft.showDelivery && shop.delivery) {
        ctx.fillStyle = t.gold;
        ctx.font = `bold ${Math.round(short * 0.028 * scDelivery)}px system-ui,Segoe UI,sans-serif`;
        this.wrapFill(ctx, shop.delivery, lx, leftY, W * 0.4, Math.round(short * 0.034), 2);
        leftY += H * 0.08 * scDelivery;
      }
      if (this.draft.showSocials) {
        const bits = [shop.socialInstagram, shop.socialFacebook].filter(Boolean);
        if (bits.length) {
          ctx.fillStyle = t.muted;
          ctx.font = `${Math.round(short * 0.024 * scBranch)}px system-ui,Segoe UI,sans-serif`;
          ctx.fillText(bits.join('  ·  '), lx, leftY);
          leftY += H * 0.055;
        }
      }
      if (shop.orderUrl) {
        ctx.fillStyle = t.gold;
        ctx.font = `600 ${Math.round(short * 0.024 * scOrder)}px system-ui,Segoe UI,sans-serif`;
        const u = String(shop.orderUrl).replace(/^https?:\/\//, '');
        ctx.fillText(u.length > 36 ? `${u.slice(0, 34)}…` : u, lx, Math.min(H * 0.9, leftY + H * 0.02));
      }

      const qr = this._qrImg;
      if (qr && shop.orderUrl) {
        const qs = Math.round(short * 0.42 * scQr);
        const qx = W * 0.58;
        const qy = (H - qs) / 2;
        ctx.fillStyle = '#fff';
        this.roundRect(ctx, qx - 14, qy - 14, qs + 28, qs + 28, 18);
        ctx.fill();
        ctx.drawImage(qr, qx, qy, qs, qs);
        ctx.fillStyle = t.gold;
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(short * 0.028 * scOrder)}px system-ui,Segoe UI,sans-serif`;
        ctx.fillText('Scan to order online', qx + qs / 2, qy + qs + Math.round(H * 0.06));
      }
      ctx.globalAlpha = 1;
      return;
    }

    // Portrait / square — vertical stack with safe gaps
    let y = H * 0.06;
    if (this.draft.includeLogo && this._logoImg) {
      const s = Math.round(short * 0.14);
      const x = (W - s) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      ctx.clip();
      this.drawCover(ctx, this._logoImg, x, y, s, s);
      ctx.restore();
      y += s + H * 0.03;
    }

    const bannerH = Math.round(short * 0.055);
    ctx.fillStyle = t.accent;
    this.roundRect(ctx, W * 0.16, y, W * 0.68, bannerH, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(short * 0.036)}px system-ui,Segoe UI,sans-serif`;
    ctx.fillText('ORDER NOW', W / 2, y + bannerH * 0.7);
    y += bannerH + H * 0.035;

    const qr = this._qrImg;
    if (qr && shop.orderUrl) {
      const qs = Math.round(short * 0.28 * scQr);
      const qx = (W - qs) / 2;
      ctx.fillStyle = '#fff';
      this.roundRect(ctx, qx - 12, y - 12, qs + 24, qs + 24, 18);
      ctx.fill();
      ctx.drawImage(qr, qx, y, qs, qs);
      ctx.fillStyle = t.gold;
      ctx.font = `bold ${Math.round(short * 0.026 * scOrder)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText('Scan to order online', W / 2, y + qs + Math.round(H * 0.032));
      y += qs + Math.round(H * 0.055 * scOrder);
    }

    if (this.draft.showContact && shop.phone) {
      ctx.fillStyle = t.text;
      ctx.font = `bold ${Math.round(short * 0.028 * scContact)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(`WhatsApp ${shop.phone}`, W / 2, y);
      y += H * 0.038 * scContact;
    }
    if (shop.branchName || shop.address) {
      ctx.fillStyle = t.muted;
      ctx.font = `${Math.round(short * 0.024 * scBranch)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(shop.branchName || shop.address, W / 2, y);
      y += H * 0.034 * scBranch;
    }
    if (this.draft.showDelivery && shop.delivery) {
      ctx.fillStyle = t.gold;
      ctx.font = `bold ${Math.round(short * 0.024 * scDelivery)}px system-ui,Segoe UI,sans-serif`;
      ctx.fillText(shop.delivery, W / 2, y);
      y += H * 0.034 * scDelivery;
    }
    if (this.draft.showSocials) {
      const bits = [shop.socialInstagram, shop.socialFacebook].filter(Boolean);
      if (bits.length) {
        ctx.fillStyle = t.muted;
        ctx.font = `${Math.round(short * 0.02 * scBranch)}px system-ui,Segoe UI,sans-serif`;
        ctx.fillText(bits.join('  ·  '), W / 2, y);
        y += H * 0.03;
      }
    }
    if (shop.orderUrl) {
      ctx.fillStyle = t.gold;
      ctx.font = `600 ${Math.round(short * 0.022 * scOrder)}px system-ui,Segoe UI,sans-serif`;
      const u = String(shop.orderUrl).replace(/^https?:\/\//, '');
      ctx.fillText(u.length > 42 ? `${u.slice(0, 40)}…` : u, W / 2, Math.min(H * 0.94, y + H * 0.02));
    }
    ctx.globalAlpha = 1;
  },

  wrapFill(ctx, text, x, y, maxW, lineH, maxLines) {
    const words = String(text).split(/\s+/);
    let line = '';
    let lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y + lines * lineH);
        lines += 1;
        line = words[i];
        if (lines >= maxLines) return;
      } else line = test;
    }
    if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineH);
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

  async togglePreview(opts) {
    if (this.previewPlaying) return this.stopPreview({ keepTime: true });
    this.readDraftFromDom();
    this.buildScenes();
    await this.ensureAssets();
    this.previewPlaying = true;
    const rangeFrom = opts && Number.isFinite(opts.from)
      ? opts.from
      : Math.max(0, Number(this.previewTime) || 0);
    const rangeUntil = opts && Number.isFinite(opts.until) ? opts.until : null;
    this._previewRangeUntil = rangeUntil;
    this.previewTime = Math.min(this.totalDuration() - 0.001, Math.max(0, rangeFrom));
    // If we were at the very end, restart from beginning
    if (this.previewTime >= this.totalDuration() - 0.05 && !(opts && Number.isFinite(opts.from))) {
      this.previewTime = 0;
    }
    const start = performance.now();
    const startOffsetMs = this.previewTime * 1000;
    const total = this.totalDuration() * 1000;
    this.stopVoicePreview?.();
    this.stopTrackListen?.();
    await this.startPreviewAudioMix?.(this.previewTime);
    if (this.previewAudioMuted) this.setPreviewMixMuted?.(true);
    const playBtn = document.getElementById('pvb-play');
    if (playBtn) playBtn.textContent = '⏸';
    const tick = (now) => {
      if (!this.previewPlaying) return;
      const elapsed = (now - start) + startOffsetMs;
      this.previewTime = Math.min(this.totalDuration(), elapsed / 1000);
      this.drawPreviewFrame(this.previewTime);
      if (this._previewOverlayCanvas) {
        const octx = this._previewOverlayCanvas.getContext('2d');
        octx.drawImage(document.getElementById('pvb-canvas'), 0, 0, this._previewOverlayCanvas.width, this._previewOverlayCanvas.height);
      }
      const scene = this.scenes.find((s) => this.previewTime >= s.start && this.previewTime < s.end);
      const hasVoiceFile = (this.audioTracks || []).some((t) => t.kind === 'voice' && t.enabled !== false);
      if (!hasVoiceFile && scene && this.draft.voiceEnabled) {
        if (scene.id !== this._lastVoiceSceneId && (this.previewTime - scene.start) < 0.2) {
          this._lastVoiceSceneId = scene.id;
          this.voicePreviewForScene?.(scene);
        }
      }
      document.querySelectorAll('#pvb-timeline .pvb-timeline-row').forEach((row) => {
        const id = row.dataset.timelineId;
        const scn = this.scenes.find((s) => s.id === id);
        row.classList.toggle('active', !!(scn && this.previewTime >= scn.start && this.previewTime < scn.end));
      });
      const hitRangeEnd = this._previewRangeUntil != null && this.previewTime >= this._previewRangeUntil - 0.02;
      if (elapsed >= total || hitRangeEnd) {
        this.previewPlaying = false;
        this._previewRangeUntil = null;
        this.stopVoicePreview?.();
        this.stopPreviewAudioMix?.();
        if (playBtn) playBtn.textContent = '▶';
        if (!hitRangeEnd && this.draft.loopPreview) {
          this.previewTime = 0;
          setTimeout(() => this.togglePreview({ from: 0 }), 400);
        }
        return;
      }
      this.previewRaf = requestAnimationFrame(tick);
    };
    this.previewRaf = requestAnimationFrame(tick);
  },

  stopPreview(opts) {
    this.previewPlaying = false;
    this._previewRangeUntil = null;
    if (this.previewRaf) cancelAnimationFrame(this.previewRaf);
    this.previewRaf = 0;
    this._lastVoiceSceneId = null;
    this.stopVoicePreview?.();
    this.stopPreviewAudioMix?.();
    const playBtn = document.getElementById('pvb-play');
    if (playBtn) playBtn.textContent = '▶';
    // Hard stop (⏹) resets to start; pause keeps scrub position
    if (opts && opts.reset) {
      this.previewTime = 0;
      this.drawPreviewFrame(0);
    }
  },

  async previewFullscreen() {
    this.readDraftFromDom();
    this.buildScenes();
    await this.ensureAssets();
    // Close existing overlay
    document.getElementById('pvb-live-overlay')?.remove();
    const fmt = this.formatSize();
    const overlay = document.createElement('div');
    overlay.id = 'pvb-live-overlay';
    overlay.className = 'pvb-live-overlay';
    overlay.innerHTML = `
      <div class="pvb-live-panel">
        <div class="pvb-live-bar">
          <strong>Preview playing</strong>
          <span id="pvb-live-time">0:00</span>
          <button type="button" class="btn btn-ghost btn-sm" id="pvb-live-close">Close</button>
        </div>
        <canvas id="pvb-live-canvas" width="${fmt.w}" height="${fmt.h}"></canvas>
      </div>`;
    document.body.appendChild(overlay);
    this._previewOverlayCanvas = document.getElementById('pvb-live-canvas');
    document.getElementById('pvb-live-close')?.addEventListener('click', () => {
      this.stopPreview();
      this._previewOverlayCanvas = null;
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.stopPreview();
        this._previewOverlayCanvas = null;
        overlay.remove();
      }
    });
    this.stopPreview();
    await this.togglePreview();
    this.toast('Preview playing — close when done', 'success');
  },

  async generateThumbnails() {
    this.readDraftFromDom();
    this.buildScenes();
    await this.ensureAssets();
    const fmt = this.formatSize();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(540, fmt.w);
    canvas.height = Math.round(canvas.width * (fmt.h / fmt.w));
    const ctx = canvas.getContext('2d');
    const total = this.totalDuration();
    const points = [];
    // Sample key moments: intro mid, each product mid, outro mid, plus evenly spaced
    (this.scenes || []).forEach((s) => {
      if (s.type === 'empty') return;
      points.push({
        t: s.start + s.duration * 0.45,
        label: s.type === 'intro' ? 'Intro' : s.type === 'outro' ? 'End screen' : (s.item?.name || s.label || s.type)
      });
    });
    if (points.length < 3) {
      [0.15, 0.4, 0.65, 0.85].forEach((f, i) => points.push({ t: total * f, label: `Frame ${i + 1}` }));
    }
    const seen = new Set();
    const thumbs = [];
    for (const pt of points.slice(0, 8)) {
      const key = pt.t.toFixed(1);
      if (seen.has(key)) continue;
      seen.add(key);
      this.renderFrame(ctx, canvas.width, canvas.height, Math.min(total - 0.05, Math.max(0, pt.t)));
      thumbs.push({
        id: `th_${Date.now()}_${thumbs.length}`,
        dataUrl: canvas.toDataURL('image/jpeg', 0.86),
        label: pt.label,
        source: 'auto',
        time: pt.t
      });
    }
    // Keep any uploaded thumbs
    const uploaded = (this.thumbnails || []).filter((t) => t.source === 'upload');
    this.thumbnails = [...thumbs, ...uploaded].slice(0, 12);
    if (this.thumbnails.length && !this.selectedThumbnailId) {
      this.selectThumbnail(this.thumbnails[0].id);
    }
    const panel = document.getElementById('pvb-thumbs-panel');
    if (panel) panel.innerHTML = this.thumbnailsHtml();
    this.bindThumbnailActions();
    this.toast(`${thumbs.length} thumbnail(s) ready — pick one or download`, 'success');
  },

  selectThumbnail(id) {
    const th = (this.thumbnails || []).find((t) => t.id === id);
    if (!th) return;
    this.selectedThumbnailId = id;
    this._lastPoster = th.dataUrl;
    this.draft.thumbnailTime = th.time || 0;
    const panel = document.getElementById('pvb-thumbs-panel');
    if (panel) panel.innerHTML = this.thumbnailsHtml();
    this.bindThumbnailActions();
  },

  downloadThumbnail(id) {
    const th = (this.thumbnails || []).find((t) => t.id === id);
    if (!th?.dataUrl) return;
    const a = document.createElement('a');
    a.href = th.dataUrl;
    a.download = `thumbnail-${(th.label || 'frame').replace(/\W+/g, '-')}.jpg`;
    a.click();
  },

  async onThumbnailUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await this.blobToDataUrl(file);
      const th = {
        id: `th_up_${Date.now()}`,
        dataUrl,
        label: file.name || 'Uploaded',
        source: 'upload'
      };
      this.thumbnails = [th, ...(this.thumbnails || [])].slice(0, 12);
      this.selectThumbnail(th.id);
      this.toast('Custom thumbnail added', 'success');
    } catch (_) {
      this.toast('Could not load image', 'error');
    }
    e.target.value = '';
  },

  bindThumbnailActions() {
    this.el?.querySelectorAll('[data-thumb-id]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.selectThumbnail(card.dataset.thumbId);
      });
    });
    this.el?.querySelectorAll('[data-use-thumb]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectThumbnail(btn.dataset.useThumb);
        this.toast('Thumbnail selected for video', 'success');
      });
    });
    this.el?.querySelectorAll('[data-dl-thumb]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadThumbnail(btn.dataset.dlThumb);
      });
    });
  },

  async generateVideo() {
    if (this.generating) return;
    this.readDraftFromDom();
    if (this.draft.outputTv || this.draft.quality === 'tv') {
      this.draft.format = 'landscape';
      this.draft.loopPreview = true;
    }
    if (this.draft.outputWhatsApp || this.draft.quality === 'whatsapp') {
      this.draft.outputWhatsApp = true;
    }
    const items = this.selectedItems();
    const hasClips = (this.timeline || []).some((s) => s.type === 'clip');
    if (!items.length && !hasClips) return this.toast('Select at least one product/combo or add a video clip', 'error');
    if (this._regenFromVidId && typeof this.checkProductChanges === 'function') {
      const changes = this.checkProductChanges(this._regenFromVidId);
      if (changes?.length) {
        const lines = changes.map((c) => c.type === 'price'
          ? `${c.name}: was ${this.money(c.was)}, now ${this.money(c.now)}`
          : `${c.name}: missing`).join('\n');
        const ok = confirm(`Product prices changed since this video was saved:\n\n${lines}\n\nUpdate with current prices?`);
        if (!ok) return;
      }
      this._regenFromVidId = null;
    }
    this.stopPreview();
    this.buildScenes();
    this.generating = true;
    this._exporting = true;
    this.generateProgress = 0;
    const btn = document.getElementById('pvb-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      await this.ensureAssets();
      const fmt = this.formatSize();
      const qSize = typeof this.qualitySize === 'function' ? this.qualitySize() : { w: fmt.w, h: fmt.h, videoBitsPerSecond: 6_000_000 };
      const canvas = document.createElement('canvas');
      canvas.width = qSize.w;
      canvas.height = qSize.h;
      const ctx = canvas.getContext('2d');
      const fps = 30;
      const totalSec = this.totalDuration();
      const stream = canvas.captureStream(fps);
      let audioCtx = null;
      let audioSources = [];
      try {
        const mixed = typeof this.mixAllTracksForExport === 'function'
          ? await this.mixAllTracksForExport(stream, totalSec)
          : null;
        if (mixed?.audioCtx) {
          audioCtx = mixed.audioCtx;
          audioSources = mixed.sources || [];
        }
      } catch (err) {
        console.warn('Audio mix skipped', err);
        audioCtx = null;
        audioSources = [];
      }
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm');
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: qSize.videoBitsPerSecond || 6_000_000 });
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start(100);

      const frames = Math.ceil(totalSec * fps);
      for (let i = 0; i <= frames; i++) {
        const t = i / fps;
        this.renderFrame(ctx, canvas.width, canvas.height, t);
        this.generateProgress = (i / frames) * 100;
        const bar = document.getElementById('pvb-progress');
        if (bar) bar.style.width = `${Math.round(this.generateProgress)}%`;
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      try { audioSources.forEach((s) => { try { s.stop(); } catch (_) { /* */ } }); } catch (_) { /* */ }
      recorder.stop();
      await done;
      if (audioCtx) try { await audioCtx.close(); } catch (_) { /* */ }
      stream.getTracks().forEach((tr) => tr.stop());

      this.generatedBlob = new Blob(chunks, { type: mime });
      if (this.generatedUrl) URL.revokeObjectURL(this.generatedUrl);
      this.generatedUrl = URL.createObjectURL(this.generatedBlob);
      // Poster from last canvas
      this._lastPoster = canvas.toDataURL('image/jpeg', 0.85);
      this.toast('Video generated — preview, download or save', 'success');
      this.paint();
    } catch (err) {
      console.error(err);
      this.toast(err?.message || 'Could not generate video (browser may block MediaRecorder)', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✨ Generate Video'; }
    } finally {
      this.generating = false;
      this._exporting = false;
      this.generateProgress = 100;
    }
  },

  downloadGenerated() {
    if (!this.generatedBlob) return this.toast('Generate a video first', 'error');
    const a = document.createElement('a');
    a.href = this.generatedUrl || URL.createObjectURL(this.generatedBlob);
    a.download = `${String(this.draft.title || 'promo-video').replace(/\W+/g, '-')}.webm`;
    a.click();
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  },

  async saveToLibrary() {
    if (!this.generatedBlob) return this.toast('Generate a video first', 'error');
    const shop = this.shopBlock();
    let dataUrl = '';
    try {
      dataUrl = await this.blobToDataUrl(this.generatedBlob);
    } catch (_) {
      return this.toast('Could not save video data', 'error');
    }
    // Keep library entries smaller when possible
    if (dataUrl.length > 4_500_000) {
      this.toast('Video is large — downloaded instead of storing in library', 'info');
      this.downloadGenerated();
      return;
    }
    const entry = {
      id: `vid_${Date.now()}`,
      title: this.draft.title || `${shop.shopName} Promo`,
      createdAt: new Date().toLocaleString(),
      branch: shop.branchName || 'All branches',
      source: this.draft.sourceLabel || this.sourceTab,
      duration: this.totalDuration(),
      format: this.draft.format,
      template: this.draft.template,
      poster: this._lastPoster || '',
      thumbnail: this._lastPoster || '',
      selectedThumbnailId: this.selectedThumbnailId || null,
      promoCaption: this.draft.promoCaption || '',
      branchId: this.branchId,
      dataUrl,
      status: 'ready',
      timelineManual: !!this.timelineManual,
      productSnapshot: this.selectedItems().map((it) => ({
        id: it.id,
        name: it.name,
        price: it.price,
        selling_price: it.selling_price ?? it.price,
        original_price: it.original_price,
        promo_active: it.promo_active
      }))
    };
    this.videos.unshift(entry);
    this.saveVideos();
    this.toast('Saved to My Videos', 'success');
    this.libraryTab = 'videos';
    this.paint();
  },

  async sharePublishCC() {
    if (!this.generatedBlob) return this.toast('Generate a video first', 'error');
    const shop = this.shopBlock();
    const title = this.draft.title || 'Promo video';
    const body = `${shop.shopName} — ${title}\n${shop.phone ? 'WhatsApp: ' + shop.phone : ''}`;
    let mediaUrl = null;
    try {
      mediaUrl = URL.createObjectURL(this.generatedBlob);
    } catch (_) { /* */ }
    if (!window.CCSharePublish?.open) {
      try {
        if (typeof Utils?.loadScript === 'function') await Utils.loadScript('js/pages/admin-communication-center.js');
      } catch (_) { /* */ }
    }
    if (!window.CCSharePublish?.open) {
      return this.toast('Open Admin → Communication Center once, then retry Share / Publish', 'error');
    }
    window.CCSharePublish.open({
      title,
      body,
      mediaUrl,
      sourceModule: 'promo-video-builder',
      app: this.app || window.App
    });
  },

  async shareWhatsApp() {
    if (!this.generatedBlob) return this.toast('Generate a video first', 'error');
    const shop = this.shopBlock();
    const msg = `${shop.shopName} — ${this.draft.title || 'Promo video'}\n${shop.phone ? 'WhatsApp: ' + shop.phone : ''}`;
    try {
      if (navigator.share && navigator.canShare) {
        const file = new File([this.generatedBlob], 'promo-video.webm', { type: this.generatedBlob.type || 'video/webm' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: shop.shopName, text: msg });
          return;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    this.downloadGenerated();
    if (typeof Utils !== 'undefined' && Utils.whatsappUrl && shop.phone) {
      window.open(Utils.whatsappUrl(shop.phone, msg), '_blank', 'noopener');
    }
    this.toast('Video downloaded — attach it in WhatsApp', 'success');
  }
};
