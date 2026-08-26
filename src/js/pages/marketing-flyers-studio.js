// Marketing Flyer Studio — extends MarketingFlyersPage with full canvas designer
(function () {
  const P = window.MarketingFlyersPage || (typeof MarketingFlyersPage !== 'undefined' ? MarketingFlyersPage : null);
  if (!P) {
    console.error('MarketingFlyersPage not found — flyer studio cannot load');
    return;
  }
  if (!window.MarketingFlyersPage) window.MarketingFlyersPage = P;

  const PRICE_TAG_STYLES = {
    shoprite: { bg: '#e30613', color: '#fff', label: 'Shoprite' },
    checkers: { bg: '#006633', color: '#fff', label: 'Checkers' },
    picknpay: { bg: '#005baa', color: '#fff', label: 'Pick n Pay' },
    spar: { bg: '#008037', color: '#fff', label: 'Spar' },
    makro: { bg: '#003087', color: '#ffd200', label: 'Makro' },
    chisanyama: { bg: '#ea580c', color: '#fff', label: 'Chisanyama Connection' }
  };

  const BG_LIBRARY = [
    { name: 'Red Promo', value: '#e11d48' },
    { name: 'Blue Weekend', value: '#2563eb' },
    { name: 'Black Friday', value: '#111827' },
    { name: 'Green Fresh', value: '#15803d' },
    { name: 'Orange Combo', value: '#ea580c' },
    { name: 'Purple Monthly', value: '#7c3aed' },
    { name: 'Gold Clearance', value: '#ca8a04' },
    { name: 'Gradient Sunset', value: 'linear-gradient(135deg,#f97316,#ec4899)' }
  ];

  const SOCIAL_SIZES = {
    facebook: 'facebook_cover',
    instagram: 'instagram_post',
    whatsapp: 'whatsapp_status',
    tiktok: 'tiktok',
    twitter: 'twitter'
  };

  const ITEM_SIZE_MULT = { small: 0.72, medium: 1, large: 1.28 };

  const STUDIO_TEMPLATES = [
    { id: 'weekend', name: 'Weekend', headline: 'WEEKEND SPECIALS', bg: '#2563eb',
      slots: { logo: { x: 3, y: 2, w: 18, h: 10 }, hero: null,
        grid: { x: 5, y: 28, w: 90, h: 58, cols: 3, rows: 3 },
        headline: { x: 5, y: 14, w: 90, h: 10 } } },
    { id: 'weekend_hero', name: 'Weekend Hero', headline: 'WEEKEND SPECIALS', bg: '#1d4ed8',
      slots: { logo: { x: 78, y: 2, w: 18, h: 10 }, hero: { x: 0, y: 0, w: 100, h: 26 },
        grid: { x: 5, y: 38, w: 90, h: 52, cols: 3, rows: 3 },
        headline: { x: 5, y: 28, w: 70, h: 8 } } },
    { id: 'monthly', name: 'Monthly', headline: 'MONTHLY SPECIALS', bg: '#7c3aed',
      slots: { logo: { x: 35, y: 2, w: 30, h: 10 }, hero: null,
        grid: { x: 5, y: 30, w: 90, h: 56, cols: 4, rows: 3 },
        headline: { x: 5, y: 14, w: 90, h: 10 } } },
    { id: 'combo', name: 'Combo', headline: 'COMBO DEALS', bg: '#ea580c',
      slots: { logo: { x: 3, y: 2, w: 16, h: 9 }, hero: null,
        grid: { x: 8, y: 26, w: 84, h: 62, cols: 2, rows: 2 },
        headline: { x: 22, y: 12, w: 56, h: 10 } } },
    { id: 'restaurant', name: 'Restaurant', headline: 'RESTAURANT SPECIALS', bg: '#b45309',
      slots: { logo: { x: 35, y: 2, w: 30, h: 10 }, hero: { x: 0, y: 0, w: 100, h: 24 },
        grid: { x: 8, y: 38, w: 84, h: 52, cols: 2, rows: 2 },
        headline: { x: 5, y: 26, w: 90, h: 8 } } },
    { id: 'restaurant_menu', name: 'Menu Board', headline: 'TODAY\'S MENU', bg: '#92400e',
      slots: { logo: { x: 40, y: 24, w: 20, h: 8 }, hero: { x: 5, y: 0, w: 90, h: 22 },
        grid: { x: 5, y: 36, w: 90, h: 54, cols: 2, rows: 3 },
        headline: { x: 5, y: 32, w: 90, h: 6 } } },
    { id: 'black_friday', name: 'Black Friday', headline: 'BLACK FRIDAY', bg: '#111827',
      slots: { logo: { x: 5, y: 3, w: 20, h: 10 }, hero: null,
        grid: { x: 4, y: 28, w: 92, h: 60, cols: 4, rows: 3 },
        headline: { x: 5, y: 14, w: 90, h: 12 } } },
    { id: 'black_friday_bold', name: 'BF Bold', headline: 'BLACK FRIDAY', bg: '#0f172a',
      slots: { logo: { x: 78, y: 2, w: 18, h: 10 }, hero: { x: 0, y: 0, w: 100, h: 18 },
        grid: { x: 3, y: 32, w: 94, h: 58, cols: 4, rows: 4 },
        headline: { x: 5, y: 20, w: 90, h: 10 } } },
    { id: 'christmas', name: 'Christmas', headline: 'CHRISTMAS SPECIALS', bg: '#dc2626',
      slots: { logo: { x: 3, y: 2, w: 18, h: 10 }, hero: { x: 5, y: 12, w: 90, h: 18 },
        grid: { x: 5, y: 38, w: 90, h: 52, cols: 3, rows: 3 },
        headline: { x: 5, y: 32, w: 90, h: 6 } } },
    { id: 'easter', name: 'Easter', headline: 'EASTER SPECIALS', bg: '#84cc16',
      slots: { logo: { x: 78, y: 2, w: 18, h: 10 }, hero: null,
        grid: { x: 5, y: 28, w: 90, h: 58, cols: 3, rows: 3 },
        headline: { x: 5, y: 14, w: 90, h: 10 } } },
    { id: 'new_products', name: 'New Products', headline: 'NEW ARRIVALS', bg: '#0ea5e9',
      slots: { logo: { x: 5, y: 2, w: 18, h: 10 }, hero: { x: 0, y: 0, w: 100, h: 20 },
        grid: { x: 5, y: 36, w: 90, h: 54, cols: 4, rows: 2 },
        headline: { x: 5, y: 22, w: 90, h: 10 } } },
    { id: 'clearance', name: 'Clearance', headline: 'CLEARANCE SALE', bg: '#f59e0b',
      slots: { logo: { x: 3, y: 2, w: 16, h: 9 }, hero: null,
        grid: { x: 5, y: 28, w: 90, h: 58, cols: 4, rows: 3 },
        headline: { x: 5, y: 12, w: 90, h: 12 } } },
    { id: 'birthday', name: 'Birthday', headline: 'BIRTHDAY SPECIALS', bg: '#e11d48',
      slots: { logo: { x: 35, y: 2, w: 30, h: 10 }, hero: { x: 10, y: 14, w: 80, h: 16 },
        grid: { x: 5, y: 38, w: 90, h: 52, cols: 3, rows: 2 },
        headline: { x: 5, y: 32, w: 90, h: 6 } } },
    { id: 'classic_grid', name: 'Classic Grid', headline: 'SPECIAL OFFERS', bg: '#15803d',
      slots: { logo: { x: 3, y: 2, w: 18, h: 10 }, hero: null,
        grid: { x: 8, y: 26, w: 84, h: 62, cols: 3, rows: 3 },
        headline: { x: 24, y: 12, w: 52, h: 10 } } },
    { id: 'banner_sale', name: 'Banner Sale', headline: 'MEGA SALE', bg: '#dc2626',
      slots: { logo: { x: 78, y: 2, w: 18, h: 10 }, hero: { x: 0, y: 0, w: 100, h: 32 },
        grid: { x: 5, y: 48, w: 90, h: 44, cols: 4, rows: 2 },
        headline: { x: 5, y: 34, w: 90, h: 10 } } }
  ];

  const TEMPLATE_PREVIEWS = [
    { id: 'birthday', label: 'Low Price Birthday', preview: 'linear-gradient(180deg,#dc2626 0%,#f97316 40%,#facc15 100%)' },
    { id: 'weekend_hero', label: 'Weekend Specials', preview: 'linear-gradient(135deg,#2563eb,#1d4ed8)' },
    { id: 'classic_grid', label: 'Single Product', preview: 'linear-gradient(135deg,#15803d,#84cc16)', maxProducts: 1 },
    { id: 'combo', label: 'Combo Deals', preview: 'linear-gradient(135deg,#ea580c,#f97316)' },
    { id: 'clearance', label: 'Clearance Grid', preview: 'linear-gradient(135deg,#f59e0b,#eab308)' },
    { id: 'banner_sale', label: 'Banner Sale', preview: 'linear-gradient(180deg,#dc2626,#111827)' },
    { id: 'black_friday_bold', label: 'Black Friday', preview: 'linear-gradient(135deg,#0f172a,#dc2626)' },
    { id: 'new_products', label: 'New Arrivals', preview: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }
  ];

  const ICON_LIBRARY = ['⭐', '🔥', '✨', '🎉', '💰', '🏷️', '🛒', '❤️', '👍', '🎁', '🍖', '🥤'];
  const STICKER_LIBRARY = ['SALE', 'NEW', 'HOT', '2 FOR 1', 'LIMITED', 'FRESH', 'BEST', 'WOW', 'SAVE', 'SPECIAL'];
  const SCHEDULE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const QR_TYPES = {
    website: { label: 'Website', build: (s) => s.website || 'https://example.com' },
    whatsapp: { label: 'WhatsApp', build: (s) => `https://wa.me/${String(s.phone || '').replace(/\D/g, '') || '27000000000'}` },
    phone: { label: 'Call shop', build: (s) => `tel:${String(s.phone || '').replace(/\D/g, '') || ''}` },
    maps: { label: 'Google Maps', build: (s) => `https://maps.google.com/?q=${encodeURIComponent(s.address || s.shop_name || 'Shop')}` }
  };

  const TEXT_STYLES = {
    headline: { label: 'Headline', fontSize: 28, fontWeight: 800, color: '#ffffff' },
    subheading: { label: 'Subheading', fontSize: 18, fontWeight: 600, color: '#ffffff' },
    body: { label: 'Body', fontSize: 14, fontWeight: 400, color: '#ffffff' },
    price: { label: 'Price', fontSize: 22, fontWeight: 800, color: '#facc15' },
    caption: { label: 'Caption', fontSize: 11, fontWeight: 400, color: '#e5e7eb' }
  };

  const RESIZABLE_TYPES = new Set(['image', 'logo', 'shape', 'price-tag', 'product', 'qr', 'icon', 'sticker']);

  let layerId = 1;
  let countdownTimer = null;
  const uid = () => `lyr-${layerId++}`;

  P.buildQrUrl = function (type, settings) {
    const s = settings || this.app?.settings || {};
    const cfg = QR_TYPES[type] || QR_TYPES.website;
    return cfg.build(s);
  };

  P.renderBarcodeHtml = function (code, color) {
    const digits = String(code || '1234567890123').replace(/\D/g, '') || '1234567890123';
    const bars = digits.split('').map((d) => {
      const w = 2 + (parseInt(d, 10) % 3);
      const h = 28 + (parseInt(d, 10) % 5) * 2;
      return `<span style="display:inline-block;width:${w}px;height:${h}px;background:${color || '#111'};margin-right:1px"></span>`;
    }).join('');
    return `<div style="background:#fff;padding:4px 6px;border-radius:4px;text-align:center"><div style="line-height:0">${bars}</div><small style="font-size:9px;color:#111">${digits.slice(0, 13)}</small></div>`;
  };

  P.formatCountdown = function (endDate) {
    if (!endDate) return '—';
    const end = new Date(endDate + 'T23:59:59');
    const diff = end - Date.now();
    if (diff <= 0) return 'EXPIRED';
    const days = Math.floor(diff / 86400000);
    const hrs = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (days > 0) return `${days}d ${hrs}h ${mins}m`;
    return `${hrs}h ${mins}m ${secs}s`;
  };

  P.recordFlyerAnalytics = async function (id, eventType) {
    if (!id || !API.recordFlyerEvent) return;
    try { await API.recordFlyerEvent(id, eventType); } catch (_) {}
  };

  P.studio = {
    selectedLayerId: null,
    currentPageIdx: 0,
    dragState: null,
    resizeState: null,
    zoom: 1
  };

  const HISTORY_MAX = 30;

  P.initCanvasHistory = function (d) {
    if (!d?.canvas) return;
    if (!d.canvas._history) d.canvas._history = [];
    if (d.canvas._historyIndex == null) d.canvas._historyIndex = -1;
  };

  P.snapshotCanvasElements = function (d) {
    return JSON.stringify(this.getStudioElements(d));
  };

  P.pushCanvasHistory = function (d) {
    if (!d?.canvas) return;
    this.initCanvasHistory(d);
    const snap = this.snapshotCanvasElements(d);
    const hist = d.canvas._history;
    const idx = d.canvas._historyIndex;
    if (idx < hist.length - 1) hist.splice(idx + 1);
    if (hist.length && hist[hist.length - 1] === snap) return;
    hist.push(snap);
    if (hist.length > HISTORY_MAX) hist.shift();
    d.canvas._historyIndex = hist.length - 1;
  };

  P.restoreCanvasSnapshot = function (d, snap) {
    const elements = JSON.parse(snap);
    const page = this.getStudioPage(d);
    page.elements = elements;
    d.canvas.elements = elements;
  };

  P.undoCanvas = function (d, refresh) {
    if (!d?.canvas) return;
    this.initCanvasHistory(d);
    const idx = d.canvas._historyIndex;
    if (idx <= 0) return Utils.toast('Nothing to undo', 'info');
    d.canvas._historyIndex = idx - 1;
    this.restoreCanvasSnapshot(d, d.canvas._history[d.canvas._historyIndex]);
    refresh?.();
  };

  P.redoCanvas = function (d, refresh) {
    if (!d?.canvas) return;
    this.initCanvasHistory(d);
    const idx = d.canvas._historyIndex;
    const hist = d.canvas._history;
    if (idx >= hist.length - 1) return Utils.toast('Nothing to redo', 'info');
    d.canvas._historyIndex = idx + 1;
    this.restoreCanvasSnapshot(d, hist[d.canvas._historyIndex]);
    refresh?.();
  };

  P.deleteSelectedLayer = function (d, refresh) {
    const id = this.studio.selectedLayerId;
    if (!id) return;
    this.pushCanvasHistory(d);
    const page = this.getStudioPage(d);
    page.elements = page.elements.filter(x => x.id !== id);
    d.canvas.elements = page.elements;
    this.studio.selectedLayerId = null;
    refresh?.();
  };

  P.duplicateSelectedLayer = function (d, refresh) {
    const id = this.studio.selectedLayerId;
    const lyr = this.getStudioElements(d).find(x => x.id === id);
    if (!lyr) return Utils.toast('Select a layer first', 'info');
    this.pushCanvasHistory(d);
    const copy = { ...JSON.parse(JSON.stringify(lyr)), id: uid(), x: (lyr.x || 0) + 5, y: (lyr.y || 0) + 5 };
    this.getStudioElements(d).push(copy);
    this.syncElementsToPage(d);
    this.studio.selectedLayerId = copy.id;
    refresh?.();
  };

  P.layerOrderSelected = function (d, delta, refresh) {
    const id = this.studio.selectedLayerId;
    const lyr = this.getStudioElements(d).find(x => x.id === id);
    if (!lyr) return;
    this.pushCanvasHistory(d);
    lyr.z = Math.max(0, (lyr.z || 0) + delta);
    refresh?.();
  };

  P.generateFlyerLayout = function (d, refresh) {
    if (!d.products?.length) return Utils.toast('Select products first (Step 1)', 'error');
    this.pushCanvasHistory(d);
    d.canvas.headline = d.canvas.headline || d.title || 'SPECIAL OFFERS';
    const tpl = this.getStudioTemplate(d.canvas.templateId);
    if (tpl) {
      d.canvas.background = tpl.bg;
      d.canvas.headline = d.canvas.headline || tpl.headline;
    } else if (!d.canvas.background || d.canvas.background === '#e11d48') {
      d.canvas.background = BG_LIBRARY[Math.floor(Math.random() * BG_LIBRARY.length)].value;
    }
    const grid = this.getActiveGridSlot(d);
    const count = Math.min(12, d.products.length);
    const cols = d.canvas.layoutCols || grid.cols;
    const rows = d.canvas.layoutRows || grid.rows || Math.ceil(count / (cols || 3));
    this.autoLayoutProducts(d.products, count, grid, d.canvas.itemSize || 'medium');
    this.getStudioPage(d).elements = [];
    d.canvas.elements = [];
    if (tpl) {
      d.canvas.templateId = tpl.id;
      this.ensureTemplateSlots(d);
      const hl = this.getStudioElements(d).find(e => e.type === 'headline');
      if (hl) hl.content = d.canvas.headline;
    } else {
      this.addStudioLayer(d, 'headline', true);
      const headline = this.getStudioElements(d).slice(-1)[0];
      if (headline) {
        headline.content = d.canvas.headline;
        headline.x = 5;
        headline.y = 3;
        headline.w = 90;
      }
    }
    this.layoutProductsInGrid(d, d.products.slice(0, count), grid, cols, rows, d.canvas.itemSize || 'medium', true);
    this.addStudioLayer(d, 'text', true);
    const footer = this.getStudioElements(d).slice(-1)[0];
    const shopName = this.app?.settings?.shop_name || '';
    if (footer) {
      footer.content = `Valid: ${d.start_date || '—'} to ${d.end_date || '—'} · ${shopName}`;
      footer.textStyle = 'caption';
      footer.fontSize = 11;
      footer.x = 5;
      footer.y = 88;
      footer.w = 90;
      footer.textAlign = 'center';
    }
    this.syncElementsToPage(d);
    Utils.toast('Flyer generated — tweak and save', 'success');
    refresh?.();
  };

  P.productImagePath = function (p) {
    return p?.picture_path || p?.image_path || p?.photo_path || '';
  };

  P.renderProductThumb = function (p, cls = 'fly-prod-thumb') {
    const src = this.productImagePath(p);
    return src
      ? `<img data-image-path="${src}" class="${cls}" alt="">`
      : `<span class="${cls} fly-prod-thumb-empty">📦</span>`;
  };

  P.layerImgHtml = function (src, wPx, hPx) {
    if (!src) return `<span class="muted" style="display:block;width:${wPx}px;height:${hPx}px;background:rgba(255,255,255,.2);border-radius:6px;text-align:center;line-height:${hPx}px">📦</span>`;
    if (String(src).startsWith('data:')) {
      return `<img src="${src}" style="width:${wPx}px;height:${hPx}px;object-fit:contain;border-radius:6px;display:block">`;
    }
    return `<img data-image-path="${src}" style="width:${wPx}px;height:${hPx}px;object-fit:contain;border-radius:6px;display:block" alt="">`;
  };

  P.resizeHandlesHtml = function (selected) {
    if (!selected) return '';
    return ['nw', 'ne', 'sw', 'se'].map(c =>
      `<span class="flyer-resize-handle" data-corner="${c}"></span>`).join('');
  };

  const origEmptyDraft = P.emptyDraft.bind(P);
  P.emptyDraft = function () {
    const d = origEmptyDraft();
    d.approval_status = 'draft';
    d.pages = [];
    d.combos = d.combos || [];
    d.canvas.elements = d.canvas.elements || [];
    d.canvas.pages = [{ id: 'page-1', name: 'Page 1', elements: [] }];
    d.canvas.schedule_days = [];
    d.canvas.countdown_end = '';
    d.canvas.backgroundImage = '';
    d.canvas.useRetailLayout = true;
    if (!d.canvas.templateId) d.canvas.templateId = 'birthday';
    return d;
  };

  P.ensureStudioPages = function (d) {
    if (!d.canvas) d.canvas = {};
    if (!d.canvas.pages?.length) {
      d.canvas.pages = [{ id: 'page-1', name: 'Page 1', elements: d.canvas.elements || [] }];
    }
    return d.canvas.pages;
  };

  P.getStudioPage = function (d) {
    const pages = this.ensureStudioPages(d);
    const idx = this.studio.currentPageIdx || 0;
    return pages[idx] || pages[0];
  };

  P.getStudioElements = function (d) {
    return this.getStudioPage(d).elements || [];
  };

  P.syncElementsToPage = function (d) {
    const page = this.getStudioPage(d);
    page.elements = d.canvas.elements || page.elements || [];
    d.canvas.elements = page.elements;
  };

  // ─── Studio extends base campaign page (list UI lives in marketing-flyers.js) ─

  P.showCreateFromPromotion = async function (el) {
    const [prodRes, sugRes] = await Promise.all([
      API.getProducts({ active_only: true }),
      API.getSmartPromotionSuggestions({ type: 'best_sellers', limit: 8 }, this.app.user)
    ]);
    const products = prodRes.data || [];
    const suggested = sugRes.data?.products || [];
    Utils.showModal('Create Flyer from Promotion', `
      <p class="muted">Select products and set promo prices. Layout and POS sync on create.</p>
      <div class="field"><label>Flyer Title</label><input id="cfp-title" value="Promotion Specials"></div>
      <div class="field"><label>Quick pick</label>
        <select id="cfp-suggest"><option value="">— Manual —</option>
          <option value="best_sellers">Best Sellers</option><option value="slow_movers">Slow Movers</option>
          <option value="low_stock">Low Stock</option><option value="high_profit">High Profit</option>
          <option value="combos">Combos</option><option value="new">New Products</option>
        </select></div>
      <div class="table-wrap" style="max-height:240px;overflow:auto"><table>
        <thead><tr><th></th><th>Product</th><th>Price</th><th>Promo %</th></tr></thead>
        <tbody id="cfp-rows">${products.slice(0, 30).map(p => `<tr data-id="${p.id}">
          <td><input type="checkbox" class="cfp-chk"></td>
          <td>${p.name}</td><td>${Utils.formatMoney(p.selling_price, this.currency || 'R')}</td>
          <td><input type="number" class="cfp-pct" value="10" min="0" max="90" style="width:60px">%</td></tr>`).join('')}
        </tbody></table></div>`,
      '<button class="btn btn-primary" id="cfp-create">Generate Flyer</button>');
    document.getElementById('cfp-suggest').addEventListener('change', async (e) => {
      const type = e.target.value;
      if (!type) return;
      const r = await API.getSmartPromotionSuggestions({ type, limit: 8 }, this.app.user);
      if (!r.success) return;
      document.querySelectorAll('#cfp-rows .cfp-chk').forEach(c => { c.checked = false; });
      (r.data?.products || []).forEach(sp => {
        const row = document.querySelector(`#cfp-rows tr[data-id="${sp.product_id}"]`);
        if (row) {
          row.querySelector('.cfp-chk').checked = true;
          row.querySelector('.cfp-pct').value = r.data.suggested_discount_percent || 10;
        }
      });
      document.getElementById('cfp-title').value = r.data.headline || 'Promotion Specials';
    });
    document.getElementById('cfp-create').addEventListener('click', async () => {
      const title = document.getElementById('cfp-title').value.trim();
      if (!title) return Utils.toast('Title required', 'error');
      const selected = [];
      document.querySelectorAll('#cfp-rows tr').forEach(row => {
        if (!row.querySelector('.cfp-chk').checked) return;
        const pid = parseInt(row.dataset.id, 10);
        const prod = products.find(p => p.id === pid);
        if (!prod) return;
        const pct = parseFloat(row.querySelector('.cfp-pct').value) || 10;
        selected.push({
          product_id: pid, name: prod.name, product_name: prod.name,
          normal_price: prod.selling_price, selling_price: prod.selling_price,
          picture_path: this.productImagePath(prod),
          promo_type: 'percent', discount_percent: pct
        });
      });
      if (!selected.length) return Utils.toast('Select at least one product', 'error');
      this.autoLayoutProducts(selected, selected.length <= 4 ? 4 : 8);
      const d = this.emptyDraft();
      d.title = title;
      d.products = selected;
      d.canvas.headline = title;
      d.apply_pos_prices = false;
      const r = await API.saveFlyer(d, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      if (['owner', 'manager'].includes(this.app?.user?.role)) {
        d.apply_pos_prices = true;
        const pr = await API.applyFlyerPosPrices(r.data.id, this.app.user);
        if (!pr.success) Utils.toast('Flyer saved but POS prices not applied: ' + pr.error, 'error');
        else Utils.toast('Flyer created — promo prices synced to POS', 'success');
      } else {
        Utils.toast('Flyer created — submit for approval before POS prices go live', 'success');
      }
      Utils.hideModal();
      await this.openFlyer(r.data.id, el);
    });
  };

  // ─── Step 1: details + scheduling ─────────────────────────────────────────
  P.renderStep1 = async function (el) {
    const d = this.draft;
    if (!this.branches.length) {
      const br = await API.getBranches();
      this.branches = br.data || [];
    }
    const sched = d.canvas.schedule_days || [];
    el.innerHTML = `<div class="form-grid">
      <div class="field"><label>Flyer Title *</label><input id="fly-title" value="${d.title || ''}" placeholder="March Specials"></div>
      <div class="field"><label>Promotion Name</label><input id="fly-promo" value="${d.promotion_name || ''}" placeholder="Birthday Specials"></div>
      <div class="field"><label>Branch</label><select id="fly-branch"><option value="">All Branches</option>
        ${this.branches.map(b => `<option value="${b.id}" ${d.branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
      </select></div>
      <div class="field"><label>Flyer Size</label><select id="fly-size">
        ${Object.entries(this.FLYER_SIZES).map(([k, v]) => `<option value="${k}" ${d.flyer_size === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select></div>
      <div class="field"><label>Start Date</label><input type="date" id="fly-start" value="${d.start_date || ''}"></div>
      <div class="field"><label>End Date (auto-expire)</label><input type="date" id="fly-end" value="${d.end_date || ''}"></div>
      <div class="field full"><label>Publish Days</label>
        <div class="flyer-schedule-days">${SCHEDULE_DAYS.map(day =>
          `<label><input type="checkbox" class="fly-sched-day" value="${day}" ${!sched.length || sched.includes(day) ? 'checked' : ''}> ${day}</label>`
        ).join('')}</div>
        <small class="muted">Flyer auto-publishes on selected days within the date range. Leave all checked for every day.</small>
      </div>
      <div class="field"><label>Countdown End</label><input type="date" id="fly-countdown-end" value="${d.canvas.countdown_end || d.end_date || ''}"></div>
      <div class="field full"><label><input type="checkbox" id="fly-apply-pos" ${d.apply_pos_prices ? 'checked' : ''} ${['owner', 'manager'].includes(this.app?.user?.role) ? '' : 'disabled'}> Apply promo prices to POS when saved</label>
        <small class="muted">${['owner', 'manager'].includes(this.app?.user?.role) ? 'When enabled, product selling prices update to promo prices. Prefer Go Live after approval.' : 'Only owner/manager can apply POS prices — use Submit for approval instead.'}</small></div>
    </div>`;
    el.querySelectorAll('.fly-sched-day').forEach(chk => chk.addEventListener('change', () => {
      d.canvas.schedule_days = [...el.querySelectorAll('.fly-sched-day:checked')].map(c => c.value);
    }));
    document.getElementById('fly-countdown-end')?.addEventListener('change', (e) => { d.canvas.countdown_end = e.target.value; });
  };

  // ─── Step 2: product filters ───────────────────────────────────────────────
  P.renderStep2 = async function (el) {
    const d = this.draft;
    const [prodRes, catRes, supRes, comboRes] = await Promise.all([
      API.getProducts({ active_only: true }), API.getCategories(),
      API.getSuppliers(''), API.getCombos({ active_only: true })
    ]);
    this.products = prodRes.data || [];
    this.categories = catRes.data || [];
    this.suppliers = supRes.data || [];
    this.combos = comboRes.data || [];
    this._prodFilter = this._prodFilter || 'all';
    const selected = new Set(d.products.map(p => p.product_id));

    el.innerHTML = `<div class="form-grid" style="margin-bottom:12px">
      <div class="field"><label>Search</label><input id="fly-prod-search" placeholder="Search products…"></div>
      <div class="field"><label>Category</label><select id="fly-prod-cat"><option value="">All</option>
        ${this.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select></div>
      <div class="field"><label>Brand</label><input id="fly-prod-brand" placeholder="Filter brand…"></div>
      <div class="field"><label>Supplier</label><select id="fly-prod-sup"><option value="">All</option>
        ${this.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
      </select></div>
    </div>
    <div class="flyer-studio-filters" style="margin-bottom:12px">
      ${[['all','All'],['best_sellers','Best Sellers'],['slow_movers','Slow Movers'],['low_stock','Low Stock'],
        ['high_profit','High Profit'],['combos','Combos'],['new','New']].map(([k,l]) =>
        `<button type="button" class="btn btn-sm ${this._prodFilter === k ? 'btn-primary' : 'btn-ghost'} fly-filter-btn" data-filter="${k}">${l}</button>`
      ).join('')}
      <button type="button" class="btn btn-sm btn-ghost" id="fly-smart-gen">✨ Smart Promotion</button>
      <button type="button" class="btn btn-sm btn-ghost" id="fly-ai-create">🤖 AI Create Flyer</button>
    </div>
    <div class="table-wrap" style="max-height:320px;overflow:auto"><table>
      <thead><tr><th></th><th></th><th>Product</th><th>Category</th><th>Stock</th><th>Price</th></tr></thead>
      <tbody id="fly-prod-list">${this.filterStudioProducts('', '', '', '').map(p => `<tr class="fly-prod-row" data-id="${p.id}" data-cat="${p.category_id || ''}" data-brand="${(p.brand || '').toLowerCase()}" data-sup="${p.supplier_id || ''}">
        <td><input type="checkbox" class="fly-prod-chk" ${selected.has(p.id) ? 'checked' : ''}></td>
        <td>${this.renderProductThumb(p)}</td>
        <td>${p.name}</td><td>${p.category_name || '—'}</td><td>${p.stock_quantity ?? 0}</td>
        <td>${Utils.formatMoney(p.selling_price, this.currency)}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="muted" style="margin-top:8px">${d.products.length} product(s) selected</p>`;

    const applyFilter = () => {
      const q = document.getElementById('fly-prod-search').value.trim().toLowerCase();
      const cat = document.getElementById('fly-prod-cat').value;
      const brand = document.getElementById('fly-prod-brand').value.trim().toLowerCase();
      const sup = document.getElementById('fly-prod-sup').value;
      document.querySelectorAll('.fly-prod-row').forEach(row => {
        const name = row.children[2].textContent.toLowerCase();
        const matchQ = !q || name.includes(q);
        const matchC = !cat || row.dataset.cat === cat;
        const matchB = !brand || row.dataset.brand.includes(brand);
        const matchS = !sup || row.dataset.sup === sup;
        row.style.display = matchQ && matchC && matchB && matchS ? '' : 'none';
      });
    };
    document.getElementById('fly-prod-search').addEventListener('input', applyFilter);
    document.getElementById('fly-prod-cat').addEventListener('change', applyFilter);
    document.getElementById('fly-prod-brand').addEventListener('input', applyFilter);
    document.getElementById('fly-prod-sup').addEventListener('change', applyFilter);

    el.querySelectorAll('.fly-filter-btn').forEach(btn => btn.addEventListener('click', async () => {
      this._prodFilter = btn.dataset.filter;
      if (this._prodFilter === 'all') { this.renderStep2(el); return; }
      const r = await API.getSmartPromotionSuggestions({ type: this._prodFilter, limit: 20 }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      d.products = (r.data?.products || []).map(p => ({ ...p, promo_type: p.promo_type || 'percent' }));
      d.canvas.headline = r.data?.headline || d.canvas.headline;
      this.renderStep2(el);
    }));

    document.getElementById('fly-smart-gen').addEventListener('click', async () => {
      const r = await API.getSmartPromotionSuggestions({ type: 'best_sellers', limit: 12 }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      d.products = r.data.products || [];
      d.canvas.headline = r.data.headline || d.canvas.headline;
      Utils.toast('Smart promotion loaded', 'success');
      this.renderStep2(el);
    });
    document.getElementById('fly-ai-create').addEventListener('click', async () => {
      const r = await API.getSmartPromotionSuggestions({ type: this._prodFilter === 'all' ? 'high_profit' : this._prodFilter, limit: 8 }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      d.products = r.data.products || [];
      d.canvas.headline = r.data.headline || 'SPECIAL OFFERS';
      d.promotion_name = 'AI Generated Promotion';
      this.autoLayoutProducts(d.products, Math.min(8, d.products.length));
      this.step = 2;
      const content = document.getElementById('fly-step-content');
      if (content) this.renderStep4(content);
      else Utils.toast('AI layout ready — go to Design step', 'success');
    });

    el.querySelectorAll('.fly-prod-chk').forEach(chk => chk.addEventListener('change', () => {
      const row = chk.closest('.fly-prod-row');
      const pid = parseInt(row.dataset.id, 10);
      const prod = this.products.find(p => p.id === pid);
      if (!prod) return;
      if (chk.checked) {
        if (!d.products.some(p => p.product_id === pid)) {
          d.products.push({
            product_id: pid, name: prod.name, product_name: prod.name,
            category: prod.category_name, normal_price: prod.selling_price,
            selling_price: prod.selling_price, promo_type: 'special',
            special_price: prod.selling_price,
            picture_path: this.productImagePath(prod),
            x: 10, y: 20
          });
        }
      } else {
        d.products = d.products.filter(p => p.product_id !== pid);
      }
      el.querySelector('.muted').textContent = `${d.products.length} product(s) selected`;
    }));
    Utils.hydrateImages(el);
  };

  P.filterStudioProducts = function (q, catId, brand, supId) {
    q = (q || '').toLowerCase();
    brand = (brand || '').toLowerCase();
    return this.products.filter(p => {
      const matchQ = !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q);
      const matchC = !catId || String(p.category_id) === String(catId);
      const matchB = !brand || (p.brand || '').toLowerCase().includes(brand);
      const matchS = !supId || String(p.supplier_id) === String(supId);
      return matchQ && matchC && matchB && matchS;
    });
  };

  // ─── Step 3: bulk price update ─────────────────────────────────────────────
  P.renderStep3 = function (el) {
    const d = this.draft;
    el.innerHTML = `<div class="flyer-studio-bulk-bar">
      <label>Quick bulk:</label>
      <button type="button" class="btn btn-sm btn-ghost bulk-quick" data-type="percent" data-val="5">5% Off</button>
      <button type="button" class="btn btn-sm btn-ghost bulk-quick" data-type="percent" data-val="10">10% Off</button>
      <button type="button" class="btn btn-sm btn-ghost bulk-quick" data-type="fixed" data-val="20">R20 Off</button>
      <span style="margin:0 8px">|</span>
      <label>Custom:</label>
      <select id="bulk-type"><option value="percent">% Off all</option><option value="fixed">Fixed off all</option></select>
      <input type="number" id="bulk-val" step="0.01" value="10" style="width:80px">
      <button class="btn btn-sm btn-primary" id="bulk-apply">Apply to All</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Product</th><th>Normal</th><th>Promo Type</th><th>Value</th><th>Special</th><th>SAVE</th></tr></thead>
      <tbody>${d.products.map((p, i) => {
        const normal = Number(p.normal_price ?? p.selling_price) || 0;
        const special = this.calcPromoPrice(normal, p);
        const save = Math.max(0, normal - special);
        return `<tr class="fly-price-row" data-idx="${i}">
          <td>${this.renderProductThumb(p)}</td>
          <td>${p.name || p.product_name}</td>
          <td>${Utils.formatMoney(normal, this.currency)}</td>
          <td><select class="fp-type">
            <option value="special" ${p.promo_type === 'special' ? 'selected' : ''}>Special Price</option>
            <option value="percent" ${p.promo_type === 'percent' ? 'selected' : ''}>% Off</option>
            <option value="fixed" ${p.promo_type === 'fixed' ? 'selected' : ''}>Fixed Off</option>
          </select></td>
          <td class="fp-val-cell">
            <input type="number" class="fp-special" step="0.01" value="${p.special_price ?? normal}" style="display:${p.promo_type === 'special' ? '' : 'none'}">
            <input type="number" class="fp-pct" step="0.1" value="${p.discount_percent || 0}" style="display:${p.promo_type === 'percent' ? '' : 'none'}">
            <input type="number" class="fp-fixed" step="0.01" value="${p.discount_amount || 0}" style="display:${p.promo_type === 'fixed' ? '' : 'none'}">
          </td>
          <td class="fp-result">${Utils.formatMoney(special, this.currency)}</td>
          <td class="fp-save" style="color:var(--success);font-weight:600">${save > 0 ? `SAVE ${Utils.formatMoney(save, this.currency)}` : '—'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No products — go back to step 2</td></tr>'}
      </tbody></table></div>`;

    Utils.hydrateImages(el);

    const applyBulk = async (type, val) => {
      d.products.forEach(p => {
        p.promo_type = type;
        if (type === 'percent') p.discount_percent = val;
        else p.discount_amount = val;
      });
      if (d.id) {
        const updates = type === 'percent' ? { promo_type: 'percent', discount_percent: val } : { promo_type: 'fixed', discount_amount: val };
        await API.bulkUpdateFlyerPrices(d.id, updates, this.app.user);
      }
      this.renderStep3(el);
      Utils.toast('Bulk prices updated', 'success');
    };

    el.querySelectorAll('.bulk-quick').forEach(btn => btn.addEventListener('click', () => {
      applyBulk(btn.dataset.type, parseFloat(btn.dataset.val) || 0);
    }));

    document.getElementById('bulk-apply')?.addEventListener('click', async () => {
      const type = document.getElementById('bulk-type').value;
      const val = parseFloat(document.getElementById('bulk-val').value) || 0;
      await applyBulk(type, val);
    });

    const updateRow = (row) => {
      const i = parseInt(row.dataset.idx, 10);
      const p = d.products[i];
      const normal = Number(p.normal_price ?? p.selling_price) || 0;
      p.promo_type = row.querySelector('.fp-type').value;
      p.special_price = parseFloat(row.querySelector('.fp-special').value) || 0;
      p.discount_percent = parseFloat(row.querySelector('.fp-pct').value) || 0;
      p.discount_amount = parseFloat(row.querySelector('.fp-fixed').value) || 0;
      row.querySelector('.fp-special').style.display = p.promo_type === 'special' ? '' : 'none';
      row.querySelector('.fp-pct').style.display = p.promo_type === 'percent' ? '' : 'none';
      row.querySelector('.fp-fixed').style.display = p.promo_type === 'fixed' ? '' : 'none';
      const special = this.calcPromoPrice(normal, p);
      const save = Math.max(0, normal - special);
      row.querySelector('.fp-result').textContent = Utils.formatMoney(special, this.currency);
      row.querySelector('.fp-save').textContent = save > 0 ? `SAVE ${Utils.formatMoney(save, this.currency)}` : '—';
    };
    el.querySelectorAll('.fly-price-row').forEach(row => {
      row.querySelector('.fp-type').addEventListener('change', () => updateRow(row));
      row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => updateRow(row)));
    });
  };

  P.getStudioTemplate = function (tplId) {
    return STUDIO_TEMPLATES.find(t => t.id === tplId);
  };

  P.getActiveGridSlot = function (d) {
    const tpl = this.getStudioTemplate(d.canvas?.templateId);
    if (tpl?.slots?.grid) return tpl.slots.grid;
    return d.canvas.layoutGrid || { x: 5, y: 28, w: 90, h: 58, cols: 3, rows: 3 };
  };

  P.snapLayerToSlot = function (layer, slot) {
    if (!slot || !layer) return;
    layer.x = slot.x;
    layer.y = slot.y;
    layer.w = slot.w;
    layer.h = slot.h;
  };

  P.ensureTemplateSlots = function (d) {
    const tpl = this.getStudioTemplate(d.canvas?.templateId);
    if (!tpl?.slots) return;
    const elements = this.getStudioElements(d);
    const slots = tpl.slots;
    if (slots.logo && !elements.find(e => e.slotId === 'logo')) {
      this.addStudioLayer(d, 'logo', true);
      const logo = this.getStudioElements(d).slice(-1)[0];
      if (logo) {
        logo.slotId = 'logo';
        logo.name = 'Logo Slot';
        logo.src = logo.src || this.app?.settings?.logo_path || '';
        logo.isPlaceholder = !logo.src;
        this.snapLayerToSlot(logo, slots.logo);
      }
    }
    if (slots.hero && !elements.find(e => e.slotId === 'hero')) {
      this.addStudioLayer(d, 'image', true);
      const hero = this.getStudioElements(d).slice(-1)[0];
      if (hero) {
        hero.slotId = 'hero';
        hero.name = 'Banner Slot';
        hero.isPlaceholder = !hero.src;
        this.snapLayerToSlot(hero, slots.hero);
      }
    }
    if (slots.headline && !elements.find(e => e.type === 'headline')) {
      this.addStudioLayer(d, 'headline', true);
      const hl = this.getStudioElements(d).slice(-1)[0];
      if (hl) {
        hl.content = d.canvas.headline || tpl.headline;
        this.snapLayerToSlot(hl, slots.headline);
        hl.w = slots.headline.w;
        hl.textAlign = 'center';
      }
    }
    this.syncElementsToPage(d);
  };

  P.applyStudioTemplate = function (d, tplId, refresh) {
    const tpl = this.getStudioTemplate(tplId);
    if (!tpl) return;
    this.pushCanvasHistory(d);
    d.canvas.templateId = tplId;
    d.canvas.headline = tpl.headline;
    d.canvas.background = tpl.bg;
    d.canvas.layoutMode = d.canvas.layoutMode || 'auto';
    const preview = TEMPLATE_PREVIEWS.find(p => p.id === tplId);
    if (preview?.maxProducts === 1) d.canvas.layoutCols = 1;
    if (tpl.slots?.grid) {
      d.canvas.layoutGrid = { ...tpl.slots.grid };
      d.canvas.layoutCols = tpl.slots.grid.cols;
      d.canvas.layoutRows = tpl.slots.grid.rows;
    }
    const page = this.getStudioPage(d);
    page.elements = page.elements.filter(e => !e.slotId && !['headline', 'product-img', 'price-tag', 'product'].includes(e.type));
    d.canvas.elements = page.elements;
    this.ensureTemplateSlots(d);
    if (d.products?.length) {
      this.layoutProductsInGrid(d, d.products, this.getActiveGridSlot(d),
        d.canvas.layoutCols, d.canvas.layoutRows, d.canvas.itemSize || 'medium', true);
    }
    refresh?.();
    Utils.toast(`Template "${tpl.name}" applied`, 'success');
  };

  P.getUserTemplates = function () {
    return (this.templates || []).filter(t => !t.is_builtin);
  };

  P.userTemplatePreviewStyle = function (tpl) {
    const bg = tpl.canvas?.background || tpl.canvas?.backgroundImage || '#6366f1';
    if (String(bg).includes('gradient')) return `background:${bg}`;
    if (String(bg).startsWith('#')) return `background:linear-gradient(135deg,${bg},#4338ca)`;
    return 'background:linear-gradient(135deg,#6366f1,#8b5cf6)';
  };

  P.renderUserTemplateButtons = function (extraClass = '') {
    return this.getUserTemplates().map(t =>
      `<button type="button" class="flyer-template-preview user-tpl${extraClass ? ' ' + extraClass : ''}" data-user-tpl="${t.id}" style="${this.userTemplatePreviewStyle(t)}" title="${t.name}">
        <span>${t.name}</span></button>`).join('');
  };

  P.applyUserTemplate = function (d, tplId, refresh) {
    const tpl = (this.templates || []).find(t => String(t.id) === String(tplId));
    if (!tpl) return Utils.toast('Template not found', 'error');
    const canvas = tpl.canvas || {};
    this.pushCanvasHistory?.(d);
    d.products = canvas.products || [];
    d.combos = canvas.combos || [];
    if (canvas.flyer_size) d.flyer_size = canvas.flyer_size;
    const { products: _p, combos: _c, ...canvasFields } = canvas;
    d.canvas = { ...d.canvas, ...canvasFields, combos: d.combos };
    d._tplApplied = true;
    this.ensureStudioPages?.(d);
    if (canvas.templateId) this.ensureTemplateSlots?.(d);
    refresh?.();
    Utils.toast(`Template "${tpl.name}" applied`, 'success');
  };

  P.flyerItemCount = function (d, products) {
    if (products?.length) return products.length;
    return (d.products?.length || 0) + (d.combos?.length || 0);
  };

  P.showProductLayoutModal = function (d, products, onDone) {
    const count = this.flyerItemCount(d, products);
    if (!count) return Utils.toast('Add products or combos first', 'error');
    const grid = this.getActiveGridSlot(d);
    const defaultCols = grid.cols || (count <= 4 ? 2 : count <= 6 ? 3 : 4);
    const defaultRows = grid.rows || Math.ceil(count / defaultCols);
    Utils.showModal('Product Layout', `
      <p class="muted">Choose how products are arranged in the grid area.</p>
      <div class="flyer-layout-mode-btns">
        <button type="button" class="btn btn-primary" id="fly-layout-auto">Auto Layout</button>
        <button type="button" class="btn btn-ghost" id="fly-layout-custom">Custom Grid</button>
      </div>
      <div id="fly-layout-custom-fields" style="display:none;margin-top:12px">
        <div class="form-grid">
          <div class="field"><label>Columns</label><input type="number" id="fly-layout-cols" min="1" max="6" value="${defaultCols}"></div>
          <div class="field"><label>Rows</label><input type="number" id="fly-layout-rows" min="1" max="6" value="${defaultRows}"></div>
          <div class="field full"><label>Item Size</label>
            <select id="fly-layout-size"><option value="small">Small</option><option value="medium" selected>Medium</option><option value="large">Large</option></select>
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="fly-layout-apply-custom" style="margin-top:8px;width:100%">Apply Custom Grid</button>
      </div>`,
      '<button type="button" class="btn btn-ghost" id="fly-layout-cancel">Cancel</button>');
    document.getElementById('fly-layout-custom')?.addEventListener('click', () => {
      document.getElementById('fly-layout-custom-fields').style.display = '';
    });
    document.getElementById('fly-layout-cancel')?.addEventListener('click', () => Utils.hideModal());
    document.getElementById('fly-layout-auto')?.addEventListener('click', () => {
      d.canvas.layoutMode = 'auto';
      d.canvas.itemSize = 'medium';
      Utils.hideModal();
      onDone?.({ mode: 'auto', cols: null, rows: null, itemSize: 'medium' });
    });
    document.getElementById('fly-layout-apply-custom')?.addEventListener('click', () => {
      d.canvas.layoutMode = 'custom';
      d.canvas.layoutCols = parseInt(document.getElementById('fly-layout-cols').value, 10) || defaultCols;
      d.canvas.layoutRows = parseInt(document.getElementById('fly-layout-rows').value, 10) || defaultRows;
      d.canvas.itemSize = document.getElementById('fly-layout-size').value || 'medium';
      Utils.hideModal();
      onDone?.({ mode: 'custom', cols: d.canvas.layoutCols, rows: d.canvas.layoutRows, itemSize: d.canvas.itemSize });
    });
  };

  P.layoutProductsInGrid = function (d, products, grid, cols, rows, itemSize, skipHistory) {
    if (!products?.length || !grid) return;
    if (!skipHistory) this.pushCanvasHistory(d);
    const count = products.length;
    if (!cols || !rows) {
      cols = count <= 2 ? 2 : count <= 4 ? 2 : count <= 6 ? 3 : count <= 8 ? 4 : 4;
      rows = Math.ceil(count / cols);
    }
    const mult = ITEM_SIZE_MULT[itemSize] || 1;
    const cellW = grid.w / cols;
    const cellH = grid.h / rows;
    const imgH = cellH * 0.62 * mult;
    const imgW = cellW * 0.88 * mult;
    products.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = grid.x + col * cellW + (cellW - imgW) / 2;
      const cy = grid.y + row * cellH + (cellH - imgH) / 2 - cellH * 0.08;
      p.x = cx;
      p.y = cy;
      p.w = imgW;
      p.h = imgH;
      p.tagX = cx;
      p.tagY = cy + imgH + 1;
      p.tagW = imgW;
    });
    const elements = this.getStudioElements(d);
    products.forEach((p, i) => {
      let imgLyr = elements.find(e => e.type === 'product-img' && e.productIdx === i);
      if (!imgLyr) {
        this.addStudioLayer(d, 'product-img', true);
        imgLyr = this.getStudioElements(d).slice(-1)[0];
      }
      if (imgLyr) {
        imgLyr.productIdx = i;
        imgLyr.src = this.productImagePath(p);
        imgLyr.name = p.name || p.product_name || 'Product';
        imgLyr.x = p.x;
        imgLyr.y = p.y;
        imgLyr.w = p.w;
        imgLyr.h = p.h;
        imgLyr.locked = true;
        imgLyr.slotLocked = true;
      }
      let tagLyr = elements.find(e => (e.type === 'price-tag' || e.type === 'product') && e.productIdx === i);
      if (!tagLyr) {
        this.addStudioLayer(d, 'price-tag', true);
        tagLyr = this.getStudioElements(d).slice(-1)[0];
      }
      if (tagLyr) {
        tagLyr.productIdx = i;
        tagLyr.name = p.name || p.product_name;
        tagLyr.priceStyle = document.getElementById('studio-price-style')?.value || 'chisanyama';
        tagLyr.x = p.tagX ?? p.x;
        tagLyr.y = p.tagY ?? (p.y + (p.h || 12));
        tagLyr.w = p.tagW ?? p.w ?? 22;
        tagLyr.h = 10;
        tagLyr.locked = false;
        tagLyr.slotLocked = false;
      }
    });
    d.canvas.layoutCols = cols;
    d.canvas.layoutRows = rows;
    d.canvas.itemSize = itemSize || d.canvas.itemSize || 'medium';
    this.syncElementsToPage(d);
  };

  P.isLayerLocked = function (lyr) {
    return lyr && (lyr.type === 'product-img' || lyr.locked || lyr.slotLocked);
  };

  P.uploadToTemplateSlot = function (d, slotId, refresh) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.pushCanvasHistory(d);
        const tpl = this.getStudioTemplate(d.canvas?.templateId);
        let lyr = this.getStudioElements(d).find(el => el.slotId === slotId);
        if (!lyr) {
          const slot = tpl?.slots?.[slotId];
          this.addStudioLayer(d, slotId === 'logo' ? 'logo' : 'image', true);
          lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) {
            lyr.slotId = slotId;
            lyr.name = slotId === 'logo' ? 'Logo' : 'Banner';
            if (slot) this.snapLayerToSlot(lyr, slot);
          }
        }
        if (lyr) {
          lyr.src = reader.result;
          lyr.isPlaceholder = false;
          if (slotId === 'logo') lyr.type = 'logo';
          lyr.slotLocked = false;
          const slot = tpl?.slots?.[slotId];
          if (slot) this.snapLayerToSlot(lyr, slot);
        }
        refresh?.();
        Utils.toast(`${slotId === 'logo' ? 'Logo' : 'Banner'} placed in slot`, 'success');
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  };

  P.promptProductLayout = function (d, refresh, products) {
    const prods = products || d.products;
    this.showProductLayoutModal(d, prods, (opts) => {
      const grid = this.getActiveGridSlot(d);
      let cols = opts.cols;
      let rows = opts.rows;
      if (opts.mode === 'auto') {
        cols = null;
        rows = null;
      }
      this.layoutProductsInGrid(d, prods, grid, cols, rows, opts.itemSize || 'medium');
      refresh?.();
      Utils.toast('Products laid out', 'success');
    });
  };

  P.formatFlyerDate = function (dateStr) {
    if (!dateStr) return '—';
    const dt = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(dt.getTime())) return dateStr;
    return dt.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  };

  P.getRetailGridCols = function (d) {
    const count = (d.products?.length || 0) + (d.combos?.length || 0);
    if (d.canvas.layoutCols) return d.canvas.layoutCols;
    const tpl = this.getStudioTemplate(d.canvas?.templateId);
    if (tpl?.slots?.grid?.cols) return tpl.slots.grid.cols;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 6) return 3;
    return 4;
  };

  P.renderRetailProductCell = function (item, currency) {
    const isCombo = item.kind === 'combo';
    const src = item.picture_path || item.image_path || '';
    const imgHtml = src
      ? `<img data-image-path="${src}" class="retail-prod-img" alt="">`
      : `<div class="retail-prod-img retail-prod-img-empty">${isCombo ? '🎁' : '📦'}</div>`;
    if (isCombo) {
      const p1 = Number(item.price || item.selling_price) || 0;
      const p2 = Number(item.combo_price_2 || item.price_2 || p1 * 1.85) || p1 * 2;
      return `<div class="retail-product-cell retail-combo-cell">
        ${imgHtml}
        <div class="retail-combo-name">${String(item.name || '').slice(0, 28)}</div>
        <div class="retail-combo-prices">
          <div>BUY 1 FOR <strong>${currency}${p1.toFixed(2)}</strong></div>
          <div>BUY 2 FOR <strong>${currency}${p2.toFixed(2)}</strong></div>
        </div>
      </div>`;
    }
    const normal = Number(item.normal_price ?? item.selling_price) || 0;
    const special = this.calcPromoPrice(normal, item);
    const save = Math.max(0, normal - special);
    return `<div class="retail-product-cell">
      ${save > 0 ? `<div class="retail-save-badge">SAVE ${currency}${save.toFixed(0)}</div>` : ''}
      ${imgHtml}
      <div class="retail-price-block">
        ${normal > special ? `<span class="retail-was">${currency}${normal.toFixed(2)}</span>` : ''}
        <span class="retail-now">${currency}${special.toFixed(2)}</span>
      </div>
      <div class="retail-prod-name">${String(item.name || item.product_name || '').slice(0, 22)}</div>
    </div>`;
  };

  P.renderRetailFlyerCanvas = function (d, cw, ch) {
    const shopName = (this.app?.settings?.shop_name || 'SHOP').toUpperCase();
    const headline = (d.canvas.headline || d.title || 'SPECIAL OFFERS').toUpperCase();
    const sub = d.promotion_name || '';
    const tpl = this.getStudioTemplate(d.canvas?.templateId);
    const bgStyle = d.canvas.backgroundImage
      ? `background:url(${d.canvas.backgroundImage}) center/cover`
      : (String(d.canvas.background || '').includes('gradient')
        ? `background:${d.canvas.background}`
        : `background:linear-gradient(165deg, ${d.canvas.background || '#dc2626'} 0%, #f97316 35%, #facc15 55%, ${d.canvas.background || '#dc2626'} 100%)`);
    const logoEl = this.getStudioElements(d).find(e => e.slotId === 'logo' && e.src);
    const logoSrc = logoEl?.src || this.app?.settings?.logo_path || '';
    const heroEl = this.getStudioElements(d).find(e => e.slotId === 'hero' && e.src);
    const heroSrc = heroEl?.src || '';
    const items = [
      ...(d.products || []).map((p, i) => ({ ...p, kind: 'product', idx: i })),
      ...(d.combos || []).map((c, i) => ({ ...c, kind: 'combo', idx: i }))
    ];
    const cols = this.getRetailGridCols(d);
    const startFmt = this.formatFlyerDate(d.start_date);
    const endFmt = this.formatFlyerDate(d.end_date);
    const font = d.canvas.fontFamily || d.branding?.font_style || 'Impact, Arial Black, sans-serif';
    let html = `<div class="retail-flyer-root" style="width:${cw}px;height:${ch}px;${bgStyle};font-family:${font}">`;
    if (heroSrc || tpl?.slots?.hero) {
      const heroImg = heroSrc
        ? (String(heroSrc).startsWith('data:') ? `<img src="${heroSrc}" class="retail-hero-img" alt="">` : `<img data-image-path="${heroSrc}" class="retail-hero-img" alt="">`)
        : '';
      html += `<div class="retail-hero">${heroImg}</div>`;
    }
    html += `<div class="retail-flyer-top">
      <div class="retail-headline-wrap">
        <div class="retail-headline">${headline}</div>
        ${sub ? `<div class="retail-subhead">${sub.toUpperCase()}</div>` : ''}
      </div>
      ${logoSrc
        ? `<div class="retail-top-logo">${String(logoSrc).startsWith('data:') ? `<img src="${logoSrc}" alt="">` : `<img data-image-path="${logoSrc}" alt="">`}</div>`
        : `<div class="retail-top-logo retail-logo-text">${shopName}</div>`}
    </div>`;
    if (items.length) {
      html += `<div class="retail-products-grid" style="grid-template-columns:repeat(${cols},1fr)">`;
      items.forEach(item => { html += this.renderRetailProductCell(item, this.currency); });
      html += `</div>`;
    } else {
      html += `<div class="retail-empty-hint">Select products or combos from the left panel</div>`;
    }
    html += `<div class="retail-footer-bar">
      <div class="retail-footer-dates">OFFERS VALID FROM ${startFmt} UNTIL ${endFmt}</div>
      <div class="retail-footer-logo">${shopName}</div>
    </div></div>`;
    return html;
  };

  P.renderFlyerCanvasContent = function (d, scale, cw, ch) {
    const useRetail = d.canvas?.useRetailLayout !== false;
    if (useRetail) {
      const overlayTypes = new Set(['text', 'headline', 'image', 'logo', 'icon', 'sticker', 'shape', 'qr', 'countdown', 'arrow', 'line']);
      const page = this.getStudioPage(d);
      const prev = page.elements;
      page.elements = prev.filter(e => overlayTypes.has(e.type));
      d.canvas.elements = page.elements;
      const html = this.renderRetailFlyerCanvas(d, cw, ch)
        + `<div class="retail-overlay-layers">${this.renderStudioLayers(d, scale, cw, ch)}</div>`;
      page.elements = prev;
      d.canvas.elements = prev;
      return html;
    }
    return this.renderStudioLayers(d, scale, cw, ch);
  };

  // ─── Auto layout ───────────────────────────────────────────────────────────
  P.autoLayoutProducts = function (products, countOrOpts, gridBounds, itemSize) {
    let count, cols, rows, grid;
    if (typeof countOrOpts === 'object' && countOrOpts !== null) {
      ({ count, cols, rows, grid, itemSize } = countOrOpts);
    } else {
      count = countOrOpts || products.length;
    }
    count = count || products.length;
    grid = grid || { x: 5, y: 28, w: 90, h: 58 };
    if (!cols || !rows) {
      cols = count <= 2 ? 2 : count <= 4 ? 2 : count <= 6 ? 3 : count <= 8 ? 4 : count <= 12 ? 4 : 4;
      rows = Math.ceil(Math.min(count, products.length) / cols);
    }
    const mult = ITEM_SIZE_MULT[itemSize] || 1;
    const cellW = grid.w / cols;
    const cellH = grid.h / rows;
    const imgW = cellW * 0.88 * mult;
    const imgH = cellH * 0.62 * mult;
    products.slice(0, count).forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      p.x = grid.x + col * cellW + (cellW - imgW) / 2;
      p.y = grid.y + row * cellH + (cellH - imgH) / 2 - cellH * 0.08;
      p.w = imgW;
      p.h = imgH;
      p.tagX = p.x;
      p.tagY = p.y + imgH + 1;
      p.tagW = imgW;
    });
  };

  // ─── Unified designer helpers ────────────────────────────────────────────────
  P.renderDesignerProductCards = function (d, filterOpts = {}) {
    const { q = '', catId = '', showInactive = false, showOos = false, tab = 'products' } = filterOpts;
    if (tab === 'combos') {
      return (this.combos || []).map(c => `<div class="flyer-product-card" data-combo-id="${c.id}">
        <input type="checkbox" class="flyer-prod-chk flyer-card-chk">
        <span class="fly-prod-thumb fly-prod-thumb-empty">🎁</span>
        <div class="flyer-product-card-name">${c.name}</div>
        <div class="flyer-product-card-price">${Utils.formatMoney(c.price || c.selling_price || 0, this.currency)}</div>
        <button type="button" class="flyer-product-add-btn fly-combo-add" data-id="${c.id}">Add</button>
      </div>`).join('') || '<p class="muted" style="padding:8px;grid-column:1/-1">No combos found</p>';
    }
    const list = this.filterStudioProducts(q, catId, '', '').filter(p => {
      if (!showInactive && p.active === false) return false;
      if (!showOos && (p.stock_quantity ?? 0) <= 0) return false;
      return true;
    });
    const selected = new Set((d.products || []).map(p => p.product_id));
    return list.map(p => `<div class="flyer-product-card${selected.has(p.id) ? ' selected' : ''}" data-id="${p.id}">
      <input type="checkbox" class="flyer-prod-chk flyer-card-chk" ${selected.has(p.id) ? 'checked' : ''}>
      ${this.renderProductThumb(p, 'fly-prod-thumb')}
      <div class="flyer-product-card-name">${p.name}</div>
      <div class="flyer-product-card-price">${Utils.formatMoney(p.selling_price, this.currency)}</div>
      <button type="button" class="flyer-product-add-btn fly-prod-add" data-id="${p.id}">Add</button>
    </div>`).join('') || '<p class="muted" style="padding:8px;grid-column:1/-1">No products match filters</p>';
  };

  P.addComboToFlyer = function (d, combo, refresh) {
    if (!d.combos) d.combos = [];
    const cid = combo.id;
    if (!d.combos.some(c => c.combo_id === cid)) {
      d.combos.push({
        combo_id: cid, name: combo.name, price: combo.price || combo.selling_price,
        selling_price: combo.price || combo.selling_price,
        combo_price_2: combo.price_2 || null,
        picture_path: combo.image_path || combo.picture_path || '',
        promo_type: 'special', special_price: combo.price || combo.selling_price
      });
    }
    if (!d.products.length && d.combos.length === 1) {
      d.canvas.layoutCols = this.getRetailGridCols(d);
      if (refresh) refresh();
      Utils.toast(`${combo.name} combo added`, 'success');
      return;
    }
    d.canvas.layoutCols = this.getRetailGridCols(d);
    if (refresh) refresh();
    Utils.toast(`${combo.name} combo added`, 'success');
  };

  P.addProductToFlyer = function (d, prod, refresh) {
    const pid = prod.id || prod.product_id;
    const isNew = !d.products.some(p => p.product_id === pid);
    if (isNew) {
      d.products.push({
        product_id: pid, name: prod.name, product_name: prod.name,
        category: prod.category_name, normal_price: prod.selling_price,
        selling_price: prod.selling_price, promo_type: 'special',
        special_price: prod.selling_price,
        picture_path: this.productImagePath(prod),
        x: 10, y: 25
      });
    }
    const hasProductLayers = this.getStudioElements(d).some(e => e.type === 'product-img');
    if (!hasProductLayers || (isNew && d.products.length === 1 && !(d.combos?.length))) {
      this.promptProductLayout(d, refresh, d.products);
      return;
    }
    d.canvas.layoutCols = this.getRetailGridCols(d);
    if (refresh) refresh();
    Utils.toast(`${prod.name} added to flyer`, 'success');
  };

  P.bindDesignerSidebar = function (el, d, refresh) {
    const grid = document.getElementById('flyer-product-grid');
    const applyGrid = () => {
      if (!grid) return;
      grid.innerHTML = this.renderDesignerProductCards(d, {
        q: document.getElementById('flyer-sidebar-search')?.value.trim() || '',
        catId: document.getElementById('flyer-sidebar-cat')?.value || '',
        showInactive: document.getElementById('flyer-show-inactive')?.checked,
        showOos: document.getElementById('flyer-show-oos')?.checked,
        tab: el.querySelector('.flyer-sidebar-tab.active')?.dataset.tab || 'products'
      }) + '<button type="button" class="flyer-add-more-card" id="flyer-add-more">+ Add More Product</button>';
      Utils.hydrateImages(grid);
      bindGridEvents();
    };
    const bindGridEvents = () => {
      grid?.querySelectorAll('.fly-prod-add').forEach(btn => btn.addEventListener('click', () => {
        const prod = this.products.find(p => p.id === parseInt(btn.dataset.id, 10));
        if (prod) this.addProductToFlyer(d, prod, refresh);
      }));
      grid?.querySelectorAll('.fly-combo-add').forEach(btn => btn.addEventListener('click', () => {
        const combo = this.combos.find(c => c.id === parseInt(btn.dataset.id, 10));
        if (combo) this.addComboToFlyer(d, combo, refresh);
      }));
      grid?.querySelectorAll('.flyer-prod-chk').forEach(chk => chk.addEventListener('change', () => {
        const card = chk.closest('.flyer-product-card');
        const pid = parseInt(card?.dataset.id, 10);
        const prod = this.products.find(p => p.id === pid);
        if (!prod) return;
        if (chk.checked) {
          const wasEmpty = !d.products.length && !(d.combos?.length);
          if (!d.products.some(p => p.product_id === pid)) {
            d.products.push({
              product_id: pid, name: prod.name, product_name: prod.name,
              category: prod.category_name, normal_price: prod.selling_price,
              selling_price: prod.selling_price, promo_type: 'special',
              special_price: prod.selling_price,
              picture_path: this.productImagePath(prod),
              x: 10, y: 25
            });
          }
          card?.classList.add('selected');
          if (wasEmpty || !this.getStudioElements(d).some(e => e.type === 'product-img')) {
            this.promptProductLayout(d, refresh);
          }
        } else {
          const idx = d.products.findIndex(p => p.product_id === pid);
          d.products = d.products.filter(p => p.product_id !== pid);
          const page = this.getStudioPage(d);
          page.elements = page.elements.filter(e => {
            if (e.type === 'product-img' && e.productIdx === idx) return false;
            if ((e.type === 'price-tag' || e.type === 'product') && e.productIdx === idx) return false;
            return true;
          });
          page.elements.forEach(e => {
            if ((e.type === 'product-img' || e.type === 'price-tag' || e.type === 'product') && e.productIdx > idx) {
              e.productIdx -= 1;
            }
          });
          d.canvas.elements = page.elements;
          card?.classList.remove('selected');
          refresh?.();
        }
      }));
      document.getElementById('flyer-add-more')?.addEventListener('click', () => {
        document.getElementById('flyer-sidebar-search')?.focus();
        Utils.toast('Search and click Add on a product', 'info');
      });
    };
    document.getElementById('flyer-sidebar-search')?.addEventListener('input', applyGrid);
    document.getElementById('flyer-sidebar-cat')?.addEventListener('change', applyGrid);
    document.getElementById('flyer-show-inactive')?.addEventListener('change', applyGrid);
    document.getElementById('flyer-show-oos')?.addEventListener('change', applyGrid);
    el.querySelectorAll('.flyer-sidebar-tab').forEach(tab => tab.addEventListener('click', () => {
      el.querySelectorAll('.flyer-sidebar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      applyGrid();
    }));
    applyGrid();
  };

  // ─── Step 4: Full studio (unified designer) ────────────────────────────────
  P.renderStep4 = async function (el) {
    try {
    const d = this.draft;
    const phase = this.step || 2;
    this.ensureStudioPages(d);
    this.syncElementsToPage(d);
    if (!this.branches?.length) {
      const br = await API.getBranches();
      this.branches = br.data || [];
    }
    if (!this.products?.length) {
      const [prodRes, catRes, comboRes] = await Promise.all([
        API.getProducts({ active_only: false }),
        API.getCategories(),
        API.getCombos({ active_only: true })
      ]);
      this.products = prodRes.data || [];
      this.categories = catRes.data || [];
      this.combos = comboRes.data || [];
    }
    if (!this.templates) {
      const tr = await API.getFlyerTemplates();
      this.templates = tr.data || [];
    }
    const userTplButtons = this.renderUserTemplateButtons();
    const canvasFont = d.canvas.fontFamily || d.branding?.font_style || 'Impact';
    const size = this.FLYER_SIZES[d.flyer_size] || this.FLYER_SIZES.a4_portrait;
    const scale = Math.min(480 / size.w, 620 / size.h);
    const cw = Math.round(size.w * scale);
    const ch = Math.round(size.h * scale);
    const sel = this.studio.selectedLayerId;
    const bgColor = (d.canvas.background || '#e11d48').startsWith('#') ? d.canvas.background : '#e11d48';
    this.initCanvasHistory(d);
    if (!d._tplApplied && d.canvas?.templateId) {
      d._tplApplied = true;
      const tpl = this.getStudioTemplate(d.canvas.templateId);
      if (tpl) {
        d.canvas.headline = d.canvas.headline || d.title || tpl.headline;
        d.canvas.background = tpl.bg;
        if (!d.title) d.title = tpl.name === 'Birthday' ? 'Low Price Birthday' : tpl.name;
        this.ensureTemplateSlots(d);
      }
    }

    el.innerHTML = `<div class="flyer-designer-app flyer-phase-${phase}${phase === 3 ? ' flyer-preview-mode' : ''}">
      <header class="flyer-designer-header">
        <div>
          <div class="flyer-breadcrumb">Marketing &gt; Flyers &amp; Promotions &gt; ${d.id ? 'Edit Flyer' : 'Create Flyer'}</div>
          <h2>Flyer / Promotion Designer &amp; Print</h2>
        </div>
        <div class="flyer-designer-header-actions">
          <select id="fd-branch" title="Branch">
            <option value="">All Branches</option>
            ${this.branches.map(b => `<option value="${b.id}" ${d.branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select>
          <select id="fd-size" title="Page size">
            ${Object.entries(this.FLYER_SIZES).filter(([k]) => ['a4_portrait','a4_landscape','a3','a2','poster'].includes(k)).map(([k, v]) =>
              `<option value="${k}" ${d.flyer_size === k ? 'selected' : ''}>${v.label} (${v.w} × ${v.h} mm)</option>`).join('')}
          </select>
          <button type="button" class="btn btn-ghost" id="flyer-header-my-flyers">My Flyers</button>
          <button type="button" class="btn btn-ghost" id="flyer-header-new">+ New</button>
          <button type="button" class="btn btn-ghost" id="flyer-header-preview">Preview</button>
          <button type="button" class="btn btn-flyer-red" id="flyer-header-save">Save</button>
        </div>
      </header>

      <div class="flyer-stepper">
        ${[['1','Select Products'],['2','Design Flyer'],['3','Preview & Print']].map(([n, label]) =>
          `<button type="button" class="flyer-stepper-btn${phase === parseInt(n,10) ? ' active' : ''}" data-designer-step="${n}">
            <span class="flyer-stepper-num">${n}</span> ${label}
          </button>`).join('')}
      </div>

      <div class="flyer-bg-row${phase === 2 ? '' : ' flyer-hidden-tools'}">
        <span class="flyer-bg-row-label">Change Background</span>
        <div class="flyer-bg-swatches">
          ${[{c:'#facc15',n:'Yellow'},{c:'#dc2626',n:'Red'},{c:'#2563eb',n:'Blue'},{c:'#111827',n:'Black'}].map(b =>
            `<button type="button" class="flyer-bg-swatch flyer-studio-bg-swatch${bgColor === b.c ? ' selected' : ''}" data-bg="${b.c}" title="${b.n}" style="background:${b.c}"></button>`).join('')}
        </div>
        <label class="btn btn-sm btn-ghost flyer-upload-bg-btn">Upload Background
          <input type="file" id="studio-bg-upload" accept="image/*" hidden></label>
      </div>

      <div class="flyer-designer-body flyer-designer-body-clean">
        <aside class="flyer-product-sidebar${phase === 1 ? ' flyer-phase-focus' : ''}${phase === 3 ? ' flyer-hidden-tools' : ''}">
          <div class="flyer-sidebar-tabs">
            <button type="button" class="flyer-sidebar-tab active" data-tab="products">Products</button>
            <button type="button" class="flyer-sidebar-tab" data-tab="combos">Combos</button>
          </div>
          <div class="flyer-sidebar-filters">
            <input type="search" id="flyer-sidebar-search" placeholder="Search products…">
            <select id="flyer-sidebar-cat"><option value="">All Categories</option>
              ${(this.categories || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
            <div class="flyer-sidebar-checks">
              <label><input type="checkbox" id="flyer-show-inactive"> Show Inactive Products</label>
              <label><input type="checkbox" id="flyer-show-oos"> Show Out of Stock</label>
            </div>
          </div>
          <div class="flyer-product-grid" id="flyer-product-grid"></div>
        </aside>

        <div class="flyer-canvas-column${phase === 2 ? ' flyer-phase-focus' : ''}">
          <div class="flyer-canvas-wrap" id="flyer-canvas-wrap">
            <div id="fly-canvas" class="flyer-studio-canvas flyer-retail-canvas" style="width:${cw}px;height:${ch}px">
              ${this.renderFlyerCanvasContent(d, scale, cw, ch)}
            </div>
          </div>
        </div>
      </div>

      <div class="flyer-bottom-panels flyer-bottom-panels-clean">
        <div class="flyer-bottom-panel">
          <h4>Flyer Details</h4>
          <div class="field"><label>Title</label><input id="fd-title" value="${d.title || ''}" placeholder="Low Price Birthday"></div>
          <div class="field-row-2">
            <div class="field"><label>Valid From</label><input type="date" id="fd-start" value="${d.start_date || ''}"></div>
            <div class="field"><label>Valid To</label><input type="date" id="fd-end" value="${d.end_date || ''}"></div>
          </div>
          <div class="field"><label>Branches</label>
            <select id="fd-branches"><option value="">All Branches</option>
              ${this.branches.map(b => `<option value="${b.id}" ${d.branch_id == b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
            </select></div>
          <div class="field"><label>Notes</label><textarea id="fd-notes" rows="2" placeholder="Optional notes…">${d.canvas.terms || ''}</textarea></div>
          <input type="hidden" id="fly-headline" value="${(d.canvas.headline || d.title || '').replace(/"/g, '&quot;')}">
          <input type="hidden" id="fly-terms" value="${(d.canvas.terms || '').replace(/"/g, '&quot;')}">
        </div>

        <div class="flyer-bottom-panel${phase === 2 ? ' flyer-phase-focus' : ''}${phase === 3 ? ' flyer-hidden-tools' : ''}">
          <h4>Design Tools</h4>
          <div class="flyer-design-tools-row">
            <button type="button" class="flyer-design-tool-btn studio-add" data-type="text"><span class="icon">T</span>Add Text</button>
            <button type="button" class="flyer-design-tool-btn studio-add" data-type="shape"><span class="icon">⬛</span>Add Shape</button>
            <button type="button" class="flyer-design-tool-btn" id="studio-upload-banner"><span class="icon">📷</span>Add Image</button>
            <button type="button" class="flyer-design-tool-btn studio-add" data-type="product"><span class="icon">🏷</span>Add Price Tag</button>
          </div>
          <div class="flyer-color-row">
            <label>Text Color<input type="color" id="fd-text-color" value="#ffffff"></label>
            <label>Price Color<input type="color" id="fd-price-color" value="#facc15"></label>
            <label>Shape Color<input type="color" id="fd-shape-color" value="#ffffff"></label>
            <label>Border Color<input type="color" id="fd-border-color" value="#111827"></label>
          </div>
          <div class="field-row-2">
            <div class="field"><label>Font</label>
              <select id="fd-font"><option value="Impact"${canvasFont === 'Impact' ? ' selected' : ''}>Impact</option><option value="Anton"${canvasFont === 'Anton' ? ' selected' : ''}>Anton</option>
                <option value="Arial"${canvasFont === 'Arial' ? ' selected' : ''}>Arial</option><option value="Georgia"${canvasFont === 'Georgia' ? ' selected' : ''}>Georgia</option></select></div>
            <div class="field"><label>Text Size</label><input type="number" id="fd-text-size" min="8" max="120" value="24"></div>
          </div>
          <select id="studio-price-style" class="field-input flyer-hidden-tools">${Object.entries(PRICE_TAG_STYLES).map(([k,v]) =>
            `<option value="${k}">${v.label}</option>`).join('')}</select>
        </div>

        <div class="flyer-bottom-panel${phase === 3 ? ' flyer-phase-focus' : ''}">
          <h4>Export &amp; Print</h4>
          <div class="flyer-export-btns">
            <button type="button" class="btn btn-flyer-red" id="flyer-dl-pdf">${d.id ? 'Download PDF' : 'Save & Download PDF'}</button>
            <button type="button" class="btn btn-flyer-green" id="studio-print">Print Flyer</button>
            <button type="button" class="btn btn-flyer-blue" id="flyer-save-template">Save Template</button>
          </div>
        </div>

        <div class="flyer-bottom-panel">
          <div class="flyer-templates-header"><h4>Saved Templates</h4><a class="flyer-view-all-link" id="flyer-view-templates">View All</a></div>
          <div class="flyer-templates-scroll">
            ${TEMPLATE_PREVIEWS.map(t =>
              `<button type="button" class="flyer-template-preview studio-tpl${d.canvas.templateId === t.id ? ' selected' : ''}" data-tpl="${t.id}" style="background:${t.preview}" title="${t.label}">
                <span>${t.label}</span></button>`).join('')}
            ${userTplButtons}
          </div>
        </div>
      </div>
    </div>`;

    const refresh = () => {
      const content = document.getElementById('fly-step-content');
      if (content) this.renderStep4(content);
    };

    this.bindDesignerSidebar(el, d, refresh);
    this.bindStudioEvents(el, d, scale, cw, ch);

    document.getElementById('flyer-header-save')?.addEventListener('click', async () => {
      this.syncStepFromDom();
      await this.saveFlyerWithPdf('draft', document.getElementById('page-content') || el);
    });
    document.getElementById('flyer-header-golive')?.addEventListener('click', async () => {
      if (!confirm('Go live? Promo prices will apply to POS.')) return;
      const r = await API.goLiveFlyer(d.id, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      d.apply_pos_prices = true;
      d.status = 'active';
      Utils.toast('Campaign is live!', 'success');
      refresh();
    });
    document.getElementById('flyer-header-end')?.addEventListener('click', async () => {
      if (!confirm('End campaign and restore POS prices?')) return;
      const r = await API.endCampaign(d.id, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      d.apply_pos_prices = false;
      Utils.toast('Campaign ended', 'success');
      refresh();
    });
    document.getElementById('flyer-header-share')?.addEventListener('click', () => this.showShareModal(d.id));
    document.getElementById('flyer-header-generate')?.addEventListener('click', () => {
      this.syncStepFromDom();
      this.generateFlyerLayout(d, refresh);
    });
    document.getElementById('flyer-header-preview')?.addEventListener('click', () => {
      this.step = 3;
      const root = document.getElementById('page-content');
      if (root) this.renderWizard(root, this.app);
    });
    document.getElementById('flyer-header-my-flyers')?.addEventListener('click', () => this.showMyFlyersModal(el));
    document.getElementById('flyer-header-new')?.addEventListener('click', () => {
      if (!confirm('Start a new flyer? Unsaved changes will be lost.')) return;
      this.draft = this.emptyDraft(this.brandKit);
      this.step = 1;
      this.draft._tplApplied = false;
      refresh();
    });
    el.querySelectorAll('[data-designer-step]').forEach(btn => btn.addEventListener('click', () => {
      this.syncStepFromDom();
      this.step = parseInt(btn.dataset.designerStep, 10);
      const root = document.getElementById('page-content');
      if (root) this.renderWizard(root, this.app);
    }));
    document.getElementById('fd-size')?.addEventListener('change', (e) => {
      d.flyer_size = e.target.value;
      refresh();
    });
    document.getElementById('fd-notes')?.addEventListener('input', (e) => {
      d.canvas.terms = e.target.value;
      const terms = document.getElementById('fly-terms');
      if (terms) terms.value = e.target.value;
    });
    document.getElementById('fd-title')?.addEventListener('input', (e) => {
      d.title = e.target.value;
      d.canvas.headline = e.target.value;
      const hl = document.getElementById('fly-headline');
      if (hl) hl.value = e.target.value;
      refresh();
    });
    document.getElementById('fd-branches')?.addEventListener('change', (e) => {
      d.branch_id = parseInt(e.target.value, 10) || null;
      const hdr = document.getElementById('fd-branch');
      if (hdr) hdr.value = e.target.value;
    });
    document.getElementById('fd-branch')?.addEventListener('change', (e) => {
      d.branch_id = parseInt(e.target.value, 10) || null;
      const bot = document.getElementById('fd-branches');
      if (bot) bot.value = e.target.value;
    });
    document.getElementById('fd-start')?.addEventListener('change', (e) => { d.start_date = e.target.value; refresh(); });
    document.getElementById('fd-end')?.addEventListener('change', (e) => { d.end_date = e.target.value; refresh(); });
    document.getElementById('flyer-dl-pdf')?.addEventListener('click', async () => {
      this.syncStepFromDom();
      if (!d.id) {
        await this.saveFlyer('draft', document.getElementById('page-content') || el);
        if (!d.id) return;
      }
      await this.downloadPdf(d.id);
    });
    document.getElementById('flyer-save-template')?.addEventListener('click', async () => {
      this.syncStepFromDom();
      const name = prompt('Template name:', d.title || 'My Template');
      if (!name) return;
      const r = await API.saveFlyerTemplate({ name, canvas: d.canvas, products: d.products, combos: d.combos, flyer_size: d.flyer_size }, this.app.user);
      if (r && !r.success) return Utils.toast(r.error, 'error');
      const tr = await API.getFlyerTemplates();
      this.templates = tr.data || [];
      Utils.toast('Template saved', 'success');
      refresh();
    });
    document.getElementById('flyer-view-templates')?.addEventListener('click', () => {
      const userTpls = this.renderUserTemplateButtons('pick-modal-tpl');
      Utils.showModal('All Templates', `<div class="flyer-templates-scroll" style="flex-wrap:wrap;max-height:360px;overflow:auto">${TEMPLATE_PREVIEWS.map(t =>
        `<button type="button" class="flyer-template-preview studio-tpl pick-modal-tpl" data-tpl="${t.id}" style="background:${t.preview}"><span>${t.label}</span></button>`).join('')}
        ${STUDIO_TEMPLATES.filter(t => !TEMPLATE_PREVIEWS.some(p => p.id === t.id)).map(t =>
        `<button type="button" class="flyer-template-preview studio-tpl pick-modal-tpl" data-tpl="${t.id}" style="background:${t.bg}"><span>${t.name}</span></button>`).join('')}
        ${userTpls ? `<div class="flyer-templates-user-section" style="width:100%;margin-top:12px"><strong>Saved Templates</strong></div>${userTpls}` : ''}
      </div>`, '');
      document.querySelectorAll('.pick-modal-tpl.studio-tpl').forEach(b => b.addEventListener('click', () => {
        this.applyStudioTemplate(d, b.dataset.tpl, refresh);
        Utils.hideModal();
      }));
      document.querySelectorAll('.pick-modal-tpl.user-tpl').forEach(b => b.addEventListener('click', () => {
        this.applyUserTemplate(d, b.dataset.userTpl, refresh);
        Utils.hideModal();
      }));
    });
    document.getElementById('fd-text-color')?.addEventListener('input', (e) => {
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (lyr && (lyr.type === 'text' || lyr.type === 'headline')) { lyr.color = e.target.value; refresh(); }
    });
    document.getElementById('fd-text-size')?.addEventListener('input', (e) => {
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (lyr && (lyr.type === 'text' || lyr.type === 'headline')) { lyr.fontSize = parseFloat(e.target.value) || 18; refresh(); }
    });
    document.getElementById('fd-font')?.addEventListener('change', (e) => {
      d.canvas.fontFamily = e.target.value;
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (lyr) lyr.fontFamily = e.target.value;
      refresh();
    });

    Utils.hydrateImages(el);
    } catch (err) {
      console.error('Flyer studio error:', err);
      el.innerHTML = `<div class="card"><div class="card-body"><p style="color:var(--danger)">Design Studio error: ${err.message}</p><button class="btn btn-primary" id="studio-retry">Retry</button></div></div>`;
      document.getElementById('studio-retry')?.addEventListener('click', () => this.renderStep4(el));
    }
  };

  P.renderStudioLayers = function (d, scale, cw, ch) {
    const elements = [...this.getStudioElements(d)].sort((a, b) => (a.z || 0) - (b.z || 0));
    let html = '';
    elements.forEach(lyr => {
      if (lyr.hidden) return;
      const x = (lyr.x / 100) * cw;
      const y = (lyr.y / 100) * ch;
      const wPx = lyr.w ? (lyr.w / 100) * cw : null;
      const hPx = lyr.h ? (lyr.h / 100) * ch : null;
      const style = this.layerStyle(lyr);
      const opacityStyle = lyr.opacity != null && lyr.opacity < 100 ? `opacity:${lyr.opacity / 100}` : '';
      const sel = this.studio.selectedLayerId === lyr.id;
      const selCls = sel ? ' flyer-studio-layer-selected' : '';
      const lockCls = this.isLayerLocked(lyr) ? ' flyer-studio-layer-locked' : '';
      const slotCls = (lyr.slotId && !lyr.src) || lyr.isPlaceholder ? ' flyer-slot-placeholder' : '';
      const handles = sel && RESIZABLE_TYPES.has(lyr.type) && !this.isLayerLocked(lyr) ? this.resizeHandlesHtml(true) : '';
      const lockIcon = this.isLayerLocked(lyr) ? '<span class="flyer-layer-lock-icon" title="Locked">🔒</span>' : '';
      const boxStyle = `left:${x}px;top:${y}px;${wPx ? `width:${wPx}px;` : ''}${hPx ? `height:${hPx}px;` : ''}${style}${opacityStyle ? ';' + opacityStyle : ''}`;
      if (lyr.type === 'price-tag' || lyr.type === 'product') {
        const p = d.products[lyr.productIdx];
        if (!p) return;
        const normal = Number(p.normal_price ?? p.selling_price) || 0;
        const special = this.calcPromoPrice(normal, p);
        const tagStyle = PRICE_TAG_STYLES[lyr.priceStyle || 'chisanyama'] || PRICE_TAG_STYLES.chisanyama;
        const imgSrc = this.productImagePath(p);
        html += `<div class="flyer-studio-layer fly-tag${selCls}${lockCls}" data-id="${lyr.id}" style="${boxStyle};background:${tagStyle.bg};color:${tagStyle.color};padding:6px 8px">
          ${imgSrc ? `<div style="text-align:center;margin-bottom:4px">${this.layerImgHtml(imgSrc, Math.min(wPx || 60, 60), Math.min(hPx || 50, 50))}</div>` : ''}
          <strong>${String(p.name || '').slice(0, 16)}</strong><br><small style="text-decoration:line-through">${this.currency}${normal.toFixed(2)}</small><br>
          <span style="font-size:1.2em;font-weight:800">${this.currency}${special.toFixed(2)}</span>${handles}</div>`;
      } else if (lyr.type === 'qr') {
        const url = lyr.content || this.buildQrUrl(lyr.qrType || 'website', this.app?.settings);
        const qrSize = wPx || 80;
        html += `<div class="flyer-studio-layer${selCls}" data-id="${lyr.id}" style="${boxStyle}">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=${Math.round(qrSize)}x${Math.round(qrSize)}&data=${encodeURIComponent(url)}" alt="QR" width="${Math.round(qrSize)}"><br><small style="font-size:9px">${QR_TYPES[lyr.qrType]?.label || 'QR'}</small>${handles}</div>`;
      } else if (lyr.type === 'barcode') {
        html += `<div class="flyer-studio-layer${selCls}" data-id="${lyr.id}" style="${boxStyle}">${this.renderBarcodeHtml(lyr.content, lyr.color)}${handles}</div>`;
      } else if (lyr.type === 'icon') {
        const fs = lyr.fontSize || (hPx ? Math.max(16, hPx * 0.8) : 32);
        html += `<div class="flyer-studio-layer${selCls}" data-id="${lyr.id}" style="${boxStyle};font-size:${fs}px">${lyr.content || '⭐'}${handles}</div>`;
      } else if (lyr.type === 'sticker') {
        html += `<div class="flyer-studio-layer${selCls}" data-id="${lyr.id}" style="${boxStyle};background:${lyr.fill || '#ef4444'};color:${lyr.color || '#fff'};padding:4px 10px;border-radius:20px;font-weight:800;font-size:${lyr.fontSize || 12}px">${lyr.content || 'SALE'}${handles}</div>`;
      } else if (lyr.type === 'product-img') {
        const p = d.products[lyr.productIdx ?? 0];
        const src = lyr.src || this.productImagePath(p);
        const iw = wPx || 80;
        const ih = hPx || 80;
        html += `<div class="flyer-studio-layer${selCls}${lockCls}" data-id="${lyr.id}" data-locked="1" style="${boxStyle}">${lockIcon}${this.layerImgHtml(src, iw, ih)}</div>`;
      } else if (lyr.type === 'image' || lyr.type === 'logo') {
        const iw = wPx || 100;
        const ih = hPx || 80;
        const slotLabel = lyr.slotId === 'logo' ? 'Upload Logo' : lyr.slotId === 'hero' ? 'Upload Banner' : 'Image';
        html += `<div class="flyer-studio-layer${selCls}${lockCls}${slotCls}" data-id="${lyr.id}" data-slot="${lyr.slotId || ''}" style="${boxStyle}">${lyr.src ? this.layerImgHtml(lyr.src, iw, ih) : `<span class="flyer-slot-label">${slotLabel}</span>`}${handles}</div>`;
      } else if (lyr.type === 'shape') {
        const sw = wPx || 40;
        const sh = hPx || 40;
        html += `<div class="flyer-studio-layer${selCls}" data-id="${lyr.id}" style="${boxStyle};width:${sw}px;height:${sh}px;background:${lyr.fill || '#fff'};border-radius:${lyr.shape === 'circle' ? '50%' : '4px'};padding:0">${handles}</div>`;
      } else if (lyr.type === 'arrow' || lyr.type === 'line') {
        const lw = wPx || 60;
        html += `<div class="flyer-studio-layer${selCls}" data-id="${lyr.id}" style="${boxStyle};width:${lw}px;height:4px;background:${lyr.color || '#fff'};transform:rotate(${lyr.rotate || 0}deg);padding:0">${handles}</div>`;
      } else if (lyr.type === 'countdown') {
        const cd = this.formatCountdown(d.canvas.countdown_end || d.end_date);
        html += `<div class="flyer-studio-layer flyer-countdown${selCls}" data-id="${lyr.id}" style="${boxStyle};color:#fff;font-weight:700;background:rgba(0,0,0,.4);padding:6px 10px;border-radius:6px">Offer Ends In: <span class="cd-val">${cd}</span>${handles}</div>`;
      } else if (lyr.type === 'text' || lyr.type === 'headline') {
        const ts = TEXT_STYLES[lyr.textStyle] || {};
        const textStyle = [
          lyr.color || ts.color ? `color:${lyr.color || ts.color}` : '',
          lyr.fontSize || ts.fontSize ? `font-size:${lyr.fontSize || ts.fontSize}px` : '',
          lyr.fontWeight || ts.fontWeight ? `font-weight:${lyr.fontWeight || ts.fontWeight}` : '',
          lyr.fontStyle ? `font-style:${lyr.fontStyle}` : '',
          lyr.textAlign ? `text-align:${lyr.textAlign};width:100%` : '',
          ts.fontWeight && !lyr.fontWeight ? `font-weight:${ts.fontWeight}` : '',
          lyr.curve ? `transform:rotate(${lyr.rotate || 0}deg) skewY(-8deg);display:inline-block` : ''
        ].filter(Boolean).join(';');
        html += `<div class="flyer-studio-layer flyer-studio-text-layer${selCls}" data-id="${lyr.id}" data-editable="1" style="${boxStyle};${lyr.curve ? textStyle : style + ';' + textStyle}">${lyr.content || lyr.name || ''}${handles}</div>`;
      } else {
        html += `<div class="flyer-studio-layer${selCls}${lockCls}" data-id="${lyr.id}" style="${boxStyle}">${lyr.content || lyr.name || ''}${handles}</div>`;
      }
    });
    if (!elements.some(e => e.type === 'headline')) {
      html += `<div id="fly-canvas-headline" style="position:absolute;top:3%;left:0;right:0;text-align:center;color:#fff;font-weight:800;font-size:${Math.max(14, scale * 7)}px;text-shadow:0 2px 4px rgba(0,0,0,.3)">${d.canvas.headline || d.title || 'SPECIAL OFFERS'}</div>`;
    }
    return html;
  };

  P.layerStyle = function (lyr) {
    const rot = lyr.rotate || 0;
    const curve = lyr.curve ? ' skewY(-8deg)' : '';
    const parts = [`z-index:${lyr.z || 1}`, `transform:rotate(${rot}deg)${curve}`];
    if (lyr.shadow) parts.push('text-shadow:2px 2px 4px rgba(0,0,0,.5)');
    if (lyr.outline) parts.push('-webkit-text-stroke:1px #000');
    if (lyr.glow) parts.push('filter:drop-shadow(0 0 6px #facc15)');
    if (lyr.gradient) parts.push('background:linear-gradient(90deg,#facc15,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent');
    if (lyr.color) parts.push(`color:${lyr.color}`);
    if (lyr.fontSize) parts.push(`font-size:${lyr.fontSize}px`);
    if (lyr.fontWeight) parts.push(`font-weight:${lyr.fontWeight}`);
    if (lyr.fontStyle) parts.push(`font-style:${lyr.fontStyle}`);
    if (lyr.textAlign) parts.push(`text-align:${lyr.textAlign}`);
    return parts.join(';');
  };

  P.renderLayerList = function (d) {
    const elements = [...this.getStudioElements(d)].sort((a, b) => (b.z || 0) - (a.z || 0));
    return elements.map(lyr => `<li class="flyer-studio-layer-item ${this.studio.selectedLayerId === lyr.id ? 'active' : ''} ${lyr.hidden ? 'hidden-layer' : ''}" data-id="${lyr.id}">
      <span>${lyr.hidden ? '○' : '✓'} ${lyr.name || lyr.type}</span>
      <span class="flyer-studio-layer-actions">
        <button type="button" class="btn-icon lyr-lock" title="Lock">${lyr.locked ? '🔒' : '🔓'}</button>
        <button type="button" class="btn-icon lyr-hide" title="Hide">${lyr.hidden ? '👁' : '🚫'}</button>
        <button type="button" class="btn-icon lyr-dup" title="Duplicate">⧉</button>
        <button type="button" class="btn-icon lyr-del" title="Delete">✕</button>
        <button type="button" class="btn-icon lyr-up" title="Forward">↑</button>
        <button type="button" class="btn-icon lyr-down" title="Backward">↓</button>
      </span></li>`).join('') || '<li class="muted">No layers</li>';
  };

  P.renderLayerProps = function (d, layerId) {
    const lyr = this.getStudioElements(d).find(e => e.id === layerId);
    if (!lyr) return '';
    const qrOpts = lyr.type === 'qr' ? `<div class="field"><label>QR Type</label><select id="lyr-qr-type">${Object.entries(QR_TYPES).map(([k, v]) =>
      `<option value="${k}" ${lyr.qrType === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>` : '';
    const priceStyle = (lyr.type === 'price-tag' || lyr.type === 'product') ? `<div class="field"><label>Price Tag Style</label><select id="lyr-price-style">${Object.entries(PRICE_TAG_STYLES).map(([k, v]) =>
      `<option value="${k}" ${lyr.priceStyle === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>` : '';
    const textStyleOpts = (lyr.type === 'text' || lyr.type === 'headline') ? `<div class="field"><label>Text Style</label><select id="lyr-text-style">${Object.entries(TEXT_STYLES).map(([k, v]) =>
      `<option value="${k}" ${lyr.textStyle === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>` : '';
    const productOpts = (lyr.type === 'price-tag' || lyr.type === 'product' || lyr.type === 'product-img') && d.products.length ? `<div class="field"><label>Product</label><select id="lyr-product-idx">${d.products.map((p, i) =>
      `<option value="${i}" ${lyr.productIdx === i ? 'selected' : ''}>${p.name || p.product_name}</option>`).join('')}</select></div>` : '';
    const sizeOpts = RESIZABLE_TYPES.has(lyr.type) ? `<div class="field"><label>Width %</label><input type="number" id="lyr-w" step="0.5" min="2" max="100" value="${lyr.w || 25}">
      </div><div class="field"><label>Height %</label><input type="number" id="lyr-h" step="0.5" min="2" max="100" value="${lyr.h || 15}"></div>` : '';
    const fontSizeOpt = ['text', 'headline', 'icon', 'sticker'].includes(lyr.type) ? `<div class="field"><label>Font Size</label><input type="number" id="lyr-font-size" min="8" max="120" value="${lyr.fontSize || TEXT_STYLES[lyr.textStyle]?.fontSize || 14}"></div>` : '';
    const imageUpload = (lyr.type === 'image' || lyr.type === 'logo') ? `<label class="btn btn-sm btn-ghost" style="cursor:pointer;margin-top:4px">Replace Image<input type="file" id="lyr-image-upload" accept="image/*" hidden></label>` : '';
    return `<div class="flyer-studio-props">
      <div class="field"><label>Name</label><input id="lyr-name" value="${lyr.name || ''}"></div>
      <div class="field"><label>Text / URL / Code</label><input id="lyr-content" value="${lyr.content || ''}"></div>
      ${qrOpts}${priceStyle}${textStyleOpts}${productOpts}${sizeOpts}${fontSizeOpt}${imageUpload}
      <div class="field"><label>Effects</label>
        <div class="flyer-effects-row">
          <label><input type="checkbox" id="lyr-shadow" ${lyr.shadow ? 'checked' : ''}> Shadow</label>
          <label><input type="checkbox" id="lyr-outline" ${lyr.outline ? 'checked' : ''}> Outline</label>
          <label><input type="checkbox" id="lyr-glow" ${lyr.glow ? 'checked' : ''}> Glow</label>
          <label><input type="checkbox" id="lyr-gradient" ${lyr.gradient ? 'checked' : ''}> Gradient</label>
          <label><input type="checkbox" id="lyr-curve" ${lyr.curve ? 'checked' : ''}> Curve</label>
        </div>
      </div>
      <div class="field"><label>Rotate °</label><input type="number" id="lyr-rotate" value="${lyr.rotate || 0}"></div>
      <div class="field"><label>Opacity %</label><input type="range" id="lyr-opacity" min="10" max="100" value="${lyr.opacity ?? 100}"></div>
      <div class="field"><label>Color</label><input type="color" id="lyr-color" value="${lyr.color || '#ffffff'}"></div>
    </div>`;
  };

  P.addStudioLayer = function (d, type, skipHistory) {
    if (!skipHistory) this.pushCanvasHistory(d);
    const elements = this.getStudioElements(d);
    const z = elements.length ? Math.max(...elements.map(e => e.z || 0)) + 1 : 1;
    const base = { id: uid(), type, name: type, x: 10, y: 10, w: 25, z, locked: false, hidden: false };
    if (type === 'product' || type === 'price-tag') {
      const idx = d.products.length ? 0 : -1;
      if (idx < 0) return Utils.toast('Add products first', 'error');
      base.type = 'price-tag';
      base.productIdx = 0;
      base.name = d.products[0]?.name || 'Price Tag';
      base.priceStyle = document.getElementById('studio-price-style')?.value || 'chisanyama';
      base.w = 22;
      base.h = 12;
    } else if (type === 'logo') {
      base.src = this.app?.settings?.logo_path || '';
      base.w = 20;
      base.h = 12;
      base.name = 'Logo';
    } else if (type === 'qr') {
      base.qrType = 'website';
      base.content = this.buildQrUrl('website');
      base.name = 'QR Code';
    } else if (type === 'barcode') {
      base.content = '1234567890123';
      base.name = 'Barcode';
    } else if (type === 'icon') {
      base.content = '⭐';
      base.fontSize = 32;
      base.name = 'Icon';
    } else if (type === 'sticker') {
      base.content = 'SALE';
      base.fill = '#ef4444';
      base.color = '#fff';
      base.name = 'Sticker';
    } else if (type === 'product-img') {
      if (!d.products.length) return Utils.toast('Add products first', 'error');
      base.type = 'product-img';
      base.productIdx = 0;
      base.src = this.productImagePath(d.products[0]);
      base.w = 18;
      base.h = 14;
      base.name = d.products[0]?.name || 'Product Image';
      base.locked = true;
      base.slotLocked = true;
    } else if (type === 'shape') {
      base.fill = '#ffffff';
      base.shape = 'rect';
      base.w = 8;
      base.h = 8;
      base.name = 'Shape';
    } else if (type === 'arrow') {
      base.color = '#ffffff';
      base.rotate = 0;
      base.w = 15;
      base.name = 'Arrow';
    } else if (type === 'line') {
      base.color = '#ffffff';
      base.w = 15;
      base.name = 'Line';
    } else if (type === 'text') {
      base.content = 'Your text here';
      base.textStyle = 'body';
      base.fontSize = TEXT_STYLES.body.fontSize;
      base.color = TEXT_STYLES.body.color;
      base.name = 'Text';
    } else if (type === 'countdown') {
      base.name = 'Countdown';
      d.canvas.countdown_end = d.end_date || '';
    } else if (type === 'headline') {
      base.content = d.canvas.headline || d.title;
      base.textStyle = 'headline';
      base.fontSize = TEXT_STYLES.headline.fontSize;
      base.color = TEXT_STYLES.headline.color;
      base.name = 'Headline';
    } else if (type === 'image') {
      base.w = 25;
      base.h = 20;
      base.name = 'Image';
    }
    elements.push(base);
    this.syncElementsToPage(d);
    this.studio.selectedLayerId = base.id;
  };

  P.bindStudioEvents = function (el, d, scale, cw, ch) {
    const refresh = () => {
      const content = document.getElementById('fly-step-content');
      if (content) this.renderStep4(content);
    };

    el.querySelectorAll('.studio-add').forEach(btn => btn.addEventListener('click', () => {
      const t = btn.dataset.type;
      if (t === 'product') {
        d.products.forEach((p, i) => {
          this.addStudioLayer(d, 'price-tag');
          const lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) { lyr.productIdx = i; lyr.name = p.name; lyr.priceStyle = document.getElementById('studio-price-style')?.value || 'chisanyama'; lyr.x = p.x || 10 + (i % 3) * 28; lyr.y = p.y || 25 + Math.floor(i / 3) * 22; }
        });
        refresh();
      } else if (t === 'product-img') {
        d.products.forEach((p, i) => {
          this.addStudioLayer(d, 'product-img');
          const lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) { lyr.productIdx = i; lyr.src = this.productImagePath(p); lyr.name = p.name; lyr.x = p.x || 8 + (i % 3) * 28; lyr.y = p.y || 20 + Math.floor(i / 3) * 22; }
        });
        refresh();
      } else if (t === 'image') {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const tpl = this.getStudioTemplate(d.canvas?.templateId);
            const heroSlot = tpl?.slots?.hero;
            if (heroSlot) {
              let hero = this.getStudioElements(d).find(el => el.slotId === 'hero');
              if (!hero) {
                this.addStudioLayer(d, 'image', true);
                hero = this.getStudioElements(d).slice(-1)[0];
                hero.slotId = 'hero';
                hero.name = 'Banner';
                this.snapLayerToSlot(hero, heroSlot);
              }
              hero.src = reader.result;
              hero.isPlaceholder = false;
              this.snapLayerToSlot(hero, heroSlot);
            } else {
              this.addStudioLayer(d, 'image');
              const lyr = this.getStudioElements(d).slice(-1)[0];
              if (lyr) lyr.src = reader.result;
            }
            refresh();
          };
          reader.readAsDataURL(file);
        };
        inp.click();
      } else if (t === 'icon') {
        Utils.showModal('Pick Icon', `<div class="flyer-tool-grid">${ICON_LIBRARY.map(ic =>
          `<button type="button" class="btn btn-sm btn-ghost pick-icon" data-icon="${ic}">${ic}</button>`).join('')}</div>`, '');
        document.querySelectorAll('.pick-icon').forEach(b => b.addEventListener('click', () => {
          this.addStudioLayer(d, 'icon');
          const lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) lyr.content = b.dataset.icon;
          Utils.hideModal();
          refresh();
        }));
      } else if (t === 'sticker') {
        Utils.showModal('Pick Sticker', `<div class="flyer-tool-grid">${STICKER_LIBRARY.map(st =>
          `<button type="button" class="btn btn-sm btn-ghost pick-sticker" data-sticker="${st}">${st}</button>`).join('')}</div>`, '');
        document.querySelectorAll('.pick-sticker').forEach(b => b.addEventListener('click', () => {
          this.addStudioLayer(d, 'sticker');
          const lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) lyr.content = b.dataset.sticker;
          Utils.hideModal();
          refresh();
        }));
      } else if (t === 'text') {
        Utils.showModal('Add Text Layer', `<div class="form-grid">${Object.entries(TEXT_STYLES).map(([k, v]) =>
          `<button type="button" class="btn btn-sm btn-ghost pick-text-style" data-style="${k}">${v.label}</button>`).join('')}</div>`, '');
        document.querySelectorAll('.pick-text-style').forEach(b => b.addEventListener('click', () => {
          this.addStudioLayer(d, 'text');
          const lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) {
            const ts = TEXT_STYLES[b.dataset.style] || TEXT_STYLES.body;
            lyr.textStyle = b.dataset.style;
            lyr.fontSize = ts.fontSize;
            lyr.color = ts.color;
            lyr.name = ts.label;
          }
          Utils.hideModal();
          refresh();
        }));
      } else if (t === 'qr') {
        Utils.showModal('QR Code Type', `<div class="form-grid">${Object.entries(QR_TYPES).map(([k, v]) =>
          `<button type="button" class="btn btn-sm btn-ghost pick-qr" data-qr="${k}">${v.label}</button>`).join('')}</div>`, '');
        document.querySelectorAll('.pick-qr').forEach(b => b.addEventListener('click', () => {
          this.addStudioLayer(d, 'qr');
          const lyr = this.getStudioElements(d).slice(-1)[0];
          if (lyr) { lyr.qrType = b.dataset.qr; lyr.content = this.buildQrUrl(b.dataset.qr); lyr.name = QR_TYPES[b.dataset.qr].label; }
          Utils.hideModal();
          refresh();
        }));
      } else {
        this.addStudioLayer(d, t);
        refresh();
      }
    }));

    el.querySelectorAll('.studio-tpl').forEach(btn => btn.addEventListener('click', () => {
      this.applyStudioTemplate(d, btn.dataset.tpl, refresh);
    }));

    el.querySelectorAll('.user-tpl').forEach(btn => btn.addEventListener('click', () => {
      this.applyUserTemplate(d, btn.dataset.userTpl, refresh);
    }));

    document.getElementById('studio-layout-products')?.addEventListener('click', () => {
      if (!this.flyerItemCount(d)) return Utils.toast('Add products or combos first', 'error');
      this.promptProductLayout(d, refresh);
    });

    document.getElementById('studio-upload-logo')?.addEventListener('click', () => {
      this.uploadToTemplateSlot(d, 'logo', refresh);
    });

    document.getElementById('studio-upload-banner')?.addEventListener('click', () => {
      const tpl = this.getStudioTemplate(d.canvas?.templateId);
      if (tpl && !tpl.slots?.hero) return Utils.toast('Current template has no banner slot — pick a hero template or add image manually', 'info');
      this.uploadToTemplateSlot(d, 'hero', refresh);
    });

    el.querySelectorAll('.studio-layout').forEach(btn => btn.addEventListener('click', () => {
      if (!this.flyerItemCount(d)) return Utils.toast('Add products or combos first', 'error');
      this.promptProductLayout(d, refresh);
    }));

    el.querySelectorAll('.flyer-studio-bg-swatch').forEach(btn => btn.addEventListener('click', () => {
      d.canvas.background = btn.dataset.bg;
      d.canvas.backgroundImage = '';
      refresh();
    }));

    document.getElementById('studio-bg-upload')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { d.canvas.backgroundImage = reader.result; refresh(); };
      reader.readAsDataURL(file);
    });

    document.getElementById('fly-headline')?.addEventListener('input', (e) => { d.canvas.headline = e.target.value; });
    document.getElementById('fly-bg')?.addEventListener('input', (e) => { d.canvas.background = e.target.value; d.canvas.backgroundImage = ''; refresh(); });
    document.getElementById('fly-terms')?.addEventListener('input', (e) => { d.canvas.terms = e.target.value; });
    el.querySelectorAll('.studio-sched-day').forEach(chk => chk.addEventListener('change', () => {
      d.canvas.schedule_days = [...el.querySelectorAll('.studio-sched-day:checked')].map(c => c.value);
    }));
    document.getElementById('studio-countdown-end')?.addEventListener('change', (e) => { d.canvas.countdown_end = e.target.value; });
    document.getElementById('studio-price-style')?.addEventListener('change', (e) => {
      const style = e.target.value;
      this.getStudioElements(d).filter(x => x.type === 'price-tag').forEach(x => { x.priceStyle = style; });
      refresh();
    });

    document.getElementById('studio-generate-flyer')?.addEventListener('click', () => {
      this.syncStepFromDom();
      this.generateFlyerLayout(d, refresh);
    });

    document.querySelector('.studio-undo')?.addEventListener('click', () => this.undoCanvas(d, refresh));
    document.querySelector('.studio-redo')?.addEventListener('click', () => this.redoCanvas(d, refresh));
    document.querySelector('.studio-dup-layer')?.addEventListener('click', () => this.duplicateSelectedLayer(d, refresh));
    document.querySelector('.studio-del-layer')?.addEventListener('click', () => this.deleteSelectedLayer(d, refresh));
    document.querySelector('.studio-fwd-layer')?.addEventListener('click', () => this.layerOrderSelected(d, 1, refresh));
    document.querySelector('.studio-back-layer')?.addEventListener('click', () => this.layerOrderSelected(d, -1, refresh));

    document.querySelector('.studio-bold')?.addEventListener('click', () => {
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (!lyr || !['text', 'headline'].includes(lyr.type)) return;
      this.pushCanvasHistory(d);
      lyr.fontWeight = lyr.fontWeight === 'bold' || lyr.fontWeight >= 700 ? 'normal' : 'bold';
      refresh();
    });
    document.querySelector('.studio-italic')?.addEventListener('click', () => {
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (!lyr || !['text', 'headline'].includes(lyr.type)) return;
      this.pushCanvasHistory(d);
      lyr.fontStyle = lyr.fontStyle === 'italic' ? 'normal' : 'italic';
      refresh();
    });
    el.querySelectorAll('.studio-align-text').forEach(btn => btn.addEventListener('click', () => {
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (!lyr || !['text', 'headline'].includes(lyr.type)) return;
      this.pushCanvasHistory(d);
      lyr.textAlign = btn.dataset.textAlign;
      refresh();
    }));

    const opacitySlider = document.getElementById('studio-layer-opacity');
    const selLyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
    if (opacitySlider && selLyr) opacitySlider.value = selLyr.opacity ?? 100;
    opacitySlider?.addEventListener('input', () => {
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (!lyr) return;
      lyr.opacity = parseInt(opacitySlider.value, 10) || 100;
      const tag = document.querySelector(`#fly-canvas [data-id="${lyr.id}"]`);
      if (tag) tag.style.opacity = lyr.opacity / 100;
    });
    opacitySlider?.addEventListener('change', () => this.pushCanvasHistory(d));

    el.querySelectorAll('.studio-zoom').forEach(btn => btn.addEventListener('click', () => {
      this.studio.zoom = parseFloat(btn.dataset.zoom) || 1;
      el.querySelectorAll('.studio-zoom').forEach(b => b.classList.toggle('active', b === btn));
      const wrap = document.getElementById('flyer-canvas-wrap');
      if (wrap) wrap.style.transform = `scale(${this.studio.zoom})`;
    }));

    if (!this._studioKeyBound) {
      this._studioKeyBound = true;
      document.addEventListener('keydown', (e) => {
        if (!this.draft?.canvas || this.view !== 'wizard' || this.step !== 2) return;
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          this.deleteSelectedLayer(this.draft, () => {
            const content = document.getElementById('fly-step-content');
            if (content) this.renderStep4(content);
          });
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undoCanvas(this.draft, () => {
            const content = document.getElementById('fly-step-content');
            if (content) this.renderStep4(content);
          });
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          e.preventDefault();
          this.redoCanvas(this.draft, () => {
            const content = document.getElementById('fly-step-content');
            if (content) this.renderStep4(content);
          });
        }
      });
    }

    document.getElementById('studio-ai-assist')?.addEventListener('click', async () => {
      const r = await API.getSmartPromotionSuggestions({ type: 'high_profit', limit: 8 }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      if (!d.products.length) d.products = r.data.products || [];
      d.canvas.headline = r.data.headline || d.canvas.headline || 'SPECIAL OFFERS';
      d.promotion_name = d.promotion_name || 'AI Generated Promotion';
      const tpl = STUDIO_TEMPLATES[Math.floor(Math.random() * STUDIO_TEMPLATES.length)];
      this.applyStudioTemplate(d, tpl.id, refresh);
      Utils.toast('AI layout applied — review and save', 'success');
    });

    el.querySelectorAll('.studio-align').forEach(btn => btn.addEventListener('click', () => this.alignLayers(d, btn.dataset.align, refresh)));
    el.querySelectorAll('.studio-page').forEach(btn => btn.addEventListener('click', () => {
      this.syncElementsToPage(d);
      this.studio.currentPageIdx = parseInt(btn.dataset.idx, 10);
      refresh();
    }));
    document.getElementById('studio-add-page')?.addEventListener('click', () => {
      this.syncElementsToPage(d);
      d.canvas.pages.push({ id: uid(), name: `Page ${d.canvas.pages.length + 1}`, elements: [] });
      this.studio.currentPageIdx = d.canvas.pages.length - 1;
      d.canvas.elements = [];
      refresh();
    });

    el.querySelectorAll('.studio-social').forEach(btn => btn.addEventListener('click', async () => {
      const platform = btn.dataset.social;
      const exportSize = SOCIAL_SIZES[platform] || d.flyer_size;
      if (d.id) {
        await this.recordFlyerAnalytics(d.id, 'share');
        await this.downloadPdf(d.id, exportSize);
        Utils.toast(`Exported for ${platform} (${this.FLYER_SIZES[exportSize]?.label || exportSize})`, 'success');
      } else {
        Utils.toast('Save flyer first', 'error');
      }
    }));

    document.getElementById('studio-print')?.addEventListener('click', () => this.showPrintOptions(d));
    document.getElementById('studio-submit')?.addEventListener('click', async () => {
      this.syncStepFromDom();
      if (!d.end_date) return Utils.toast('End date is required before submit', 'error');
      await this.saveFlyer('draft', document.getElementById('page-content') || el);
      if (d.id) {
        const r = await API.submitFlyerApproval(d.id, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        d.approval_status = 'pending';
        Utils.toast('Submitted for approval', 'success');
        refresh();
      }
    });

    this.bindLayerListEvents(el, d, refresh);
    this.bindCanvasDrag(document.getElementById('fly-canvas'), d, cw, ch, refresh);
    this.bindCanvasResize(document.getElementById('fly-canvas'), d, cw, ch, refresh);
    Utils.hydrateImages(document.getElementById('fly-canvas'));

    if (d.id) {
      this.recordFlyerAnalytics(d.id, 'view');
      API.getFlyerAnalytics(d.id).then(r => {
        const box = document.getElementById('studio-analytics');
        if (!box || !r.success) return;
        const a = r.data || {};
        box.innerHTML = [['Views', a.views], ['Prints', a.prints], ['Exports', a.exports || a.shares], ['PDF', a.pdf_downloads], ['Promo Sales', a.promo_sales]].map(([l, n]) =>
          `<div class="flyer-stat-card"><span class="flyer-stat-num">${n || 0}</span><span class="flyer-stat-label">${l}</span></div>`).join('');
      });
    }

    if (countdownTimer) clearInterval(countdownTimer);
    if (this.getStudioElements(d).some(e => e.type === 'countdown')) {
      countdownTimer = setInterval(() => {
        document.querySelectorAll('.flyer-countdown .cd-val').forEach(node => {
          node.textContent = this.formatCountdown(d.canvas.countdown_end || d.end_date);
        });
      }, 1000);
    }
  };

  P.alignLayers = function (d, mode, refresh) {
    const sel = this.getStudioElements(d).filter(e => e.id === this.studio.selectedLayerId);
    const targets = sel.length ? sel : this.getStudioElements(d).filter(e => e.type === 'price-tag');
    if (!targets.length) return;
    if (mode === 'left') targets.forEach(e => { e.x = 5; });
    else if (mode === 'right') targets.forEach(e => { e.x = 70; });
    else if (mode === 'center-h') targets.forEach(e => { e.x = 35; });
    else if (mode === 'top') targets.forEach(e => { e.y = 15; });
    else if (mode === 'bottom') targets.forEach(e => { e.y = 75; });
    else if (mode === 'center-v') targets.forEach(e => { e.y = 40; });
    else if (mode === 'space' && targets.length > 1) {
      const step = 80 / (targets.length - 1);
      targets.forEach((e, i) => { e.x = 10 + i * step; });
    }
    refresh();
  };

  P.bindLayerListEvents = function (el, d, refresh) {
    el.querySelectorAll('.flyer-studio-layer-item').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-icon')) return;
        this.studio.selectedLayerId = li.dataset.id;
        refresh();
      });
      li.querySelector('.lyr-lock')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const lyr = this.getStudioElements(d).find(x => x.id === li.dataset.id);
        if (lyr && lyr.type !== 'product-img') lyr.locked = !lyr.locked;
        refresh();
      });
      li.querySelector('.lyr-hide')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const lyr = this.getStudioElements(d).find(x => x.id === li.dataset.id);
        if (lyr) lyr.hidden = !lyr.hidden;
        refresh();
      });
      li.querySelector('.lyr-dup')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const lyr = this.getStudioElements(d).find(x => x.id === li.dataset.id);
        if (lyr) {
          this.pushCanvasHistory(d);
          this.getStudioElements(d).push({ ...JSON.parse(JSON.stringify(lyr)), id: uid(), x: lyr.x + 5, y: lyr.y + 5 });
        }
        refresh();
      });
      li.querySelector('.lyr-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushCanvasHistory(d);
        const page = this.getStudioPage(d);
        page.elements = page.elements.filter(x => x.id !== li.dataset.id);
        d.canvas.elements = page.elements;
        refresh();
      });
      li.querySelector('.lyr-up')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const lyr = this.getStudioElements(d).find(x => x.id === li.dataset.id);
        if (lyr) { this.pushCanvasHistory(d); lyr.z = (lyr.z || 0) + 1; }
        refresh();
      });
      li.querySelector('.lyr-down')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const lyr = this.getStudioElements(d).find(x => x.id === li.dataset.id);
        if (lyr) { this.pushCanvasHistory(d); lyr.z = Math.max(0, (lyr.z || 0) - 1); }
        refresh();
      });
    });

    ['lyr-name', 'lyr-content', 'lyr-shadow', 'lyr-outline', 'lyr-glow', 'lyr-gradient', 'lyr-curve', 'lyr-rotate', 'lyr-color', 'lyr-opacity', 'lyr-qr-type', 'lyr-price-style', 'lyr-text-style', 'lyr-w', 'lyr-h', 'lyr-font-size', 'lyr-product-idx'].forEach(id => {
      const node = document.getElementById(id);
      if (!node) return;
      const evt = node.type === 'checkbox' || node.tagName === 'SELECT' ? 'change' : 'input';
      node.addEventListener(evt, () => {
        const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
        if (!lyr) return;
        if (evt === 'change' && id !== 'lyr-opacity') this.pushCanvasHistory(d);
        if (id === 'lyr-name') lyr.name = node.value;
        if (id === 'lyr-content') lyr.content = node.value;
        if (id === 'lyr-shadow') lyr.shadow = node.checked;
        if (id === 'lyr-outline') lyr.outline = node.checked;
        if (id === 'lyr-glow') lyr.glow = node.checked;
        if (id === 'lyr-gradient') lyr.gradient = node.checked;
        if (id === 'lyr-curve') lyr.curve = node.checked;
        if (id === 'lyr-rotate') lyr.rotate = parseFloat(node.value) || 0;
        if (id === 'lyr-color') lyr.color = node.value;
        if (id === 'lyr-opacity') {
          lyr.opacity = parseInt(node.value, 10) || 100;
          if (evt === 'change') this.pushCanvasHistory(d);
        }
        if (id === 'lyr-qr-type') { lyr.qrType = node.value; lyr.content = this.buildQrUrl(node.value); }
        if (id === 'lyr-price-style') lyr.priceStyle = node.value;
        if (id === 'lyr-text-style') {
          lyr.textStyle = node.value;
          const ts = TEXT_STYLES[node.value];
          if (ts) { lyr.fontSize = ts.fontSize; if (!lyr.color || lyr.color === '#ffffff') lyr.color = ts.color; }
        }
        if (id === 'lyr-w') lyr.w = parseFloat(node.value) || lyr.w;
        if (id === 'lyr-h') lyr.h = parseFloat(node.value) || lyr.h;
        if (id === 'lyr-font-size') lyr.fontSize = parseFloat(node.value) || lyr.fontSize;
        if (id === 'lyr-product-idx') {
          lyr.productIdx = parseInt(node.value, 10) || 0;
          const p = d.products[lyr.productIdx];
          if (p && (lyr.type === 'product-img' || lyr.type === 'price-tag')) {
            lyr.src = this.productImagePath(p);
            lyr.name = p.name || p.product_name;
          }
        }
        refresh();
      });
    });

    document.getElementById('lyr-image-upload')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const lyr = this.getStudioElements(d).find(x => x.id === this.studio.selectedLayerId);
      if (!lyr) return;
      const reader = new FileReader();
      reader.onload = () => {
        lyr.src = reader.result;
        lyr.isPlaceholder = false;
        const tpl = this.getStudioTemplate(d.canvas?.templateId);
        if (lyr.slotId && tpl?.slots?.[lyr.slotId]) this.snapLayerToSlot(lyr, tpl.slots[lyr.slotId]);
        refresh();
      };
      reader.readAsDataURL(file);
    });
  };

  P.bindCanvasDrag = function (canvas, d, cw, ch, refresh) {
    if (!canvas) return;
    canvas.querySelectorAll('.flyer-studio-layer, .fly-tag').forEach(tag => {
      tag.addEventListener('mousedown', (e) => {
        if (e.target.closest('.flyer-resize-handle')) return;
        if (tag.isContentEditable) return;
        e.preventDefault();
        const id = tag.dataset.id;
        const lyr = this.getStudioElements(d).find(x => x.id === id);
        if (this.isLayerLocked(lyr)) return;
        this.studio.selectedLayerId = id;
        const rect = canvas.getBoundingClientRect();
        this.studio.dragState = { id, ox: e.clientX - tag.offsetLeft, oy: e.clientY - tag.offsetTop, rect, cw, ch };
      });
      tag.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const id = tag.dataset.id;
        const lyr = this.getStudioElements(d).find(x => x.id === id);
        if (!lyr || !['text', 'headline'].includes(lyr.type)) return;
        if (this.studio.dragState) this.studio.dragState = null;
        tag.contentEditable = 'true';
        tag.classList.add('flyer-studio-layer-editing');
        tag.focus();
        const range = document.createRange();
        range.selectNodeContents(tag);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
      tag.addEventListener('blur', () => {
        if (tag.contentEditable !== 'true') return;
        const id = tag.dataset.id;
        const lyr = this.getStudioElements(d).find(x => x.id === id);
        if (lyr) {
          lyr.content = tag.textContent.trim();
          if (lyr.type === 'headline') d.canvas.headline = lyr.content;
        }
        tag.contentEditable = 'false';
        tag.classList.remove('flyer-studio-layer-editing');
        this.pushCanvasHistory(d);
        refresh?.();
      });
      tag.addEventListener('keydown', (e) => {
        if (tag.contentEditable !== 'true') return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          tag.blur();
        }
        e.stopPropagation();
      });
    });
    if (this._studioDragBound) return;
    this._studioDragBound = true;
    document.addEventListener('mousemove', (e) => {
      const st = this.studio.dragState;
      if (!st) return;
      const lyr = this.getStudioElements(this.draft)?.find(x => x.id === st.id);
      if (!lyr) return;
      const x = Math.max(0, Math.min(st.cw - 20, e.clientX - st.rect.left - st.ox));
      const y = Math.max(0, Math.min(st.ch - 20, e.clientY - st.rect.top - st.oy));
      lyr.x = (x / st.cw) * 100;
      lyr.y = (y / st.ch) * 100;
      const tag = document.querySelector(`#fly-canvas [data-id="${st.id}"]`);
      if (tag) { tag.style.left = x + 'px'; tag.style.top = y + 'px'; }
    });
    document.addEventListener('mouseup', () => {
      if (this.studio.dragState) {
        this.pushCanvasHistory(this.draft);
        this.studio.dragState = null;
      }
    });
  };

  P.bindCanvasResize = function (canvas, d, cw, ch, refresh) {
    if (!canvas) return;
    canvas.querySelectorAll('.flyer-resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const layer = handle.closest('.flyer-studio-layer, .fly-tag');
        if (!layer) return;
        const id = layer.dataset.id;
        const lyr = this.getStudioElements(d).find(x => x.id === id);
        if (!lyr || this.isLayerLocked(lyr)) return;
        this.studio.selectedLayerId = id;
        this.studio.resizeState = {
          id, corner: handle.dataset.corner,
          startX: e.clientX, startY: e.clientY,
          startW: lyr.w || 25, startH: lyr.h || 15,
          startLyrX: lyr.x, startLyrY: lyr.y, cw, ch
        };
      });
    });
    if (this._studioResizeBound) return;
    this._studioResizeBound = true;
    document.addEventListener('mousemove', (e) => {
      const st = this.studio.resizeState;
      if (!st) return;
      const lyr = this.getStudioElements(this.draft)?.find(x => x.id === st.id);
      if (!lyr) return;
      const dx = ((e.clientX - st.startX) / st.cw) * 100;
      const dy = ((e.clientY - st.startY) / st.ch) * 100;
      if (st.corner.includes('e')) lyr.w = Math.max(3, Math.min(100 - lyr.x, st.startW + dx));
      if (st.corner.includes('s')) lyr.h = Math.max(3, Math.min(100 - lyr.y, st.startH + dy));
      if (st.corner.includes('w')) {
        lyr.w = Math.max(3, st.startW - dx);
        lyr.x = Math.max(0, st.startLyrX + dx);
      }
      if (st.corner.includes('n')) {
        lyr.h = Math.max(3, st.startH - dy);
        lyr.y = Math.max(0, st.startLyrY + dy);
      }
      const tag = document.querySelector(`#fly-canvas [data-id="${st.id}"]`);
      if (tag) {
        tag.style.width = ((lyr.w / 100) * st.cw) + 'px';
        tag.style.left = ((lyr.x / 100) * st.cw) + 'px';
        tag.style.top = ((lyr.y / 100) * st.ch) + 'px';
        const img = tag.querySelector('img');
        if (img && lyr.h) {
          img.style.width = ((lyr.w / 100) * st.cw) + 'px';
          img.style.height = ((lyr.h / 100) * st.ch) + 'px';
        }
      }
    });
    document.addEventListener('mouseup', () => {
      if (this.studio.resizeState) {
        this.pushCanvasHistory(this.draft);
        this.studio.resizeState = null;
        const content = document.getElementById('fly-step-content');
        if (content) this.renderStep4(content);
      }
    });
  };

  P.showPrintOptions = function (d) {
    Utils.showModal('Print Options', `
      <div class="form-grid">
        <div class="field"><label>Size</label><select id="print-size">
          <option value="a4_portrait">A4 Portrait</option><option value="a4_landscape">A4 Landscape</option>
          <option value="a3">A3</option><option value="a2">A2</option><option value="poster">Poster</option>
        </select></div>
        <div class="field"><label>Colour</label><select id="print-colour"><option value="colour">Colour</option><option value="bw">Black & White</option></select></div>
        <div class="field"><label>Copies</label><input type="number" id="print-copies" value="1" min="1"></div>
      </div>`,
      '<button class="btn btn-primary" id="print-go">Print</button>');
    document.getElementById('print-go').addEventListener('click', async () => {
      d.flyer_size = document.getElementById('print-size').value;
      d.canvas.printMode = document.getElementById('print-colour').value;
      const copies = parseInt(document.getElementById('print-copies').value, 10) || 1;
      Utils.hideModal();
      for (let i = 0; i < copies; i++) await this.printFlyer();
      if (d.id) await this.recordFlyerAnalytics(d.id, 'print');
    });
  };

  const origSyncStepFromDom = P.syncStepFromDom.bind(P);
  P.syncStepFromDom = function () {
    origSyncStepFromDom();
    const d = this.draft;
    if (!d?.canvas) return;
    if (this.step === 1) {
      d.canvas.countdown_end = document.getElementById('fly-countdown-end')?.value || d.canvas.countdown_end;
      const days = [...document.querySelectorAll('.fly-sched-day:checked')].map(c => c.value);
      if (document.querySelectorAll('.fly-sched-day').length) d.canvas.schedule_days = days;
    }
    if (this.step <= 3) {
      d.title = document.getElementById('fd-title')?.value.trim() || d.title;
      d.promotion_name = document.getElementById('fd-promo')?.value.trim() || d.promotion_name || '';
      d.branch_id = parseInt(document.getElementById('fd-branches')?.value || document.getElementById('fd-branch')?.value, 10) || null;
      d.start_date = document.getElementById('fd-start')?.value || d.start_date;
      d.end_date = document.getElementById('fd-end')?.value || '';
      d.flyer_size = document.getElementById('fd-size')?.value || d.flyer_size;
      d.apply_pos_prices = document.getElementById('fd-apply-pos')?.checked ?? d.apply_pos_prices;
      d.canvas.headline = document.getElementById('fly-headline')?.value.trim() || d.title || d.canvas.headline;
      d.canvas.terms = document.getElementById('fd-notes')?.value.trim() || document.getElementById('fly-terms')?.value.trim() || d.canvas.terms;
    }
  };

  const origSaveFlyer = P.saveFlyer.bind(P);
  P.saveFlyerWithPdf = async function (status, el) {
    this.syncStepFromDom();
    const d = this.draft;
    if (d?.canvas) {
      this.syncElementsToPage(d);
      d.pages = d.canvas.pages;
    }
    const payload = {
      id: d.id, title: d.title?.trim(), promotion_name: d.promotion_name,
      branch_id: d.branch_id, start_date: d.start_date || null, end_date: d.end_date || null,
      flyer_size: d.flyer_size, status: status || d.status || 'draft',
      products: d.products, canvas: { ...d.canvas, combos: d.combos || [] }, branding: d.branding,
      apply_pos_prices: d.apply_pos_prices, pages: d.canvas?.pages
    };
    if (!payload.title) return Utils.toast('Title is required', 'error');
    const r = await API.saveFlyer(payload, this.app.user);
    if (!r.success) return Utils.toast(r.error, 'error');
    d.id = r.data.id;
    d.flyer_number = r.data.flyer_number;
    d.status = r.data.status;
    d.combos = r.data.combos || d.combos || [];
    if (d.apply_pos_prices && ['owner', 'manager'].includes(this.app?.user?.role)) {
      const pr = await API.applyFlyerPosPrices(d.id, this.app.user);
      if (!pr.success) Utils.toast('Saved but POS prices not applied: ' + pr.error, 'error');
    } else if (d.apply_pos_prices) {
      d.apply_pos_prices = false;
      Utils.toast('Flyer saved — POS prices require owner/manager Go Live after approval', 'info');
    }
    const pdf = await this.saveFlyerPdfToDevice(d);
    if (!pdf.success) {
      Utils.toast('Flyer saved but PDF export failed: ' + (pdf.error || 'unknown'), 'error');
    } else {
      Utils.toast(pdf.path
        ? `Flyer saved & PDF exported to ${pdf.path}`
        : 'Flyer saved & PDF exported to Documents/ShopPOS/exports/', 'success');
    }
    if (status === 'draft' && this.view === 'wizard') {
      const root = document.getElementById('page-content') || el;
      this.render(root, this.app);
      return;
    }
    this.view = 'wizard';
    this.render(el, this.app);
  };

  P.saveFlyer = async function (status, el) {
    this.syncStepFromDom();
    const d = this.draft;
    if (d?.canvas) {
      this.syncElementsToPage(d);
      d.pages = d.canvas.pages;
    }
    const result = await origSaveFlyer(status, el);
    if (d?.id) {
      const pdf = await this.saveFlyerPdfToDevice(d);
      if (pdf.success && pdf.path && (status !== 'draft' || this.view === 'list')) {
        Utils.toast(`PDF exported to ${pdf.path}`, 'success');
      }
    }
    return result;
  };

  const origOpenFlyer = P.openFlyer.bind(P);
  const origDownloadPdf = P.downloadPdf.bind(P);
  P.openFlyer = async function (id, el, startStep) {
    const r = await API.getFlyer(id);
    await origOpenFlyer(id, el, startStep || 1);
    const f = this.draft;
    const src = r.success ? r.data : null;
    if (f) {
      f.approval_status = src?.approval_status || f.approval_status || 'draft';
      f.canvas = f.canvas || {};
      if (src?.canvas?.pages?.length) f.canvas.pages = src.canvas.pages;
      else if (src?.pages?.length) f.canvas.pages = src.pages;
      else this.ensureStudioPages(f);
      if (src?.canvas?.elements?.length && !f.canvas.pages[0]?.elements?.length) {
        f.canvas.pages[0].elements = src.canvas.elements;
        f.canvas.elements = src.canvas.elements;
      }
      f.canvas.schedule_days = f.canvas.schedule_days || src?.canvas?.schedule_days || [];
      f.canvas.countdown_end = f.canvas.countdown_end || src?.canvas?.countdown_end || f.end_date || '';
      f.combos = src?.combos || src?.canvas?.combos || f.combos || [];
      f.canvas.useRetailLayout = f.canvas.useRetailLayout !== false;
      this.studio.currentPageIdx = 0;
      this.studio.selectedLayerId = null;
      if (startStep === 4 || startStep === 2) this.step = 2;
      else if (startStep) this.step = Math.min(3, startStep);
    }
  };

  P.downloadPdf = async function (id, sizeOverride) {
    if (!id) return Utils.toast('Save flyer first', 'error');
    await origDownloadPdf.call(this, id, sizeOverride);
    if (id) await this.recordFlyerAnalytics(id, 'pdf');
  };

  const origBuildPrintHtml = P.buildPrintHtml.bind(P);
  const origPrintFlyer = P.printFlyer.bind(P);

  P.buildCanvasPrintHtml = function (d, settings) {
    const s = settings || this.app?.settings || {};
    const size = this.FLYER_SIZES[d.flyer_size] || this.FLYER_SIZES.a4_portrait;
    const pxW = size.px ? size.w : Math.round(size.w * 3.78);
    const pxH = size.px ? size.h : Math.round(size.h * 3.78);
    const cw = pxW;
    const ch = pxH;
    const bg = d.canvas.backgroundImage
      ? `background:url(${d.canvas.backgroundImage}) center/cover`
      : `background:${d.canvas.background || '#e11d48'}`;
    const layers = this.renderStudioLayers(d, 1, cw, ch);
    const bwFilter = d.canvas.printMode === 'bw' ? 'filter:grayscale(100%);' : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${d.title || 'Flyer'}</title>
      <style>body{margin:0;font-family:Arial,sans-serif;${bwFilter}} .flyer-print-page{position:relative;width:${pxW}px;height:${pxH}px;${bg};overflow:hidden;margin:0 auto}
      .flyer-studio-layer,.fly-tag{position:absolute;cursor:default;user-select:none}</style></head>
      <body><div class="flyer-print-page" id="fly-print-canvas">${layers}
      ${d.canvas.terms ? `<div style="position:absolute;bottom:2%;left:4%;right:4%;color:#fff;font-size:10px;text-align:center">${d.canvas.terms}</div>` : ''}
      <div style="position:absolute;bottom:1%;left:4%;color:#fff;font-size:9px">${s.address || ''} · ${s.phone || ''}</div>
      </div></body></html>`;
  };

  P.buildPrintHtml = function () {
    const d = this.draft;
    const elements = this.getStudioElements?.(d) || d?.canvas?.elements || [];
    if (elements.length && this.renderStudioLayers) {
      return this.buildCanvasPrintHtml(d, this.app?.settings);
    }
    let html = origBuildPrintHtml();
    if (d?.canvas?.printMode === 'bw') {
      html = html.replace('<body style="margin:0;font-family:Arial,sans-serif">',
        '<body style="margin:0;font-family:Arial,sans-serif;filter:grayscale(100%)">');
    }
    return html;
  };

  P.printFlyer = async function () {
    if (!this.draft?.id) return Utils.toast('Save the flyer first', 'error');
    this.syncStepFromDom();
    const html = this.buildPrintHtml();
    const title = this.draft.title || 'Flyer';
    const isMobile = !!(window.__SHOP_POS_MOBILE__ || window.Capacitor?.isNativePlatform?.());
    try {
      if (isMobile) {
        const pr = await API.printPreview(html, title);
        if (pr?.success !== false) Utils.toast('Print preview opened', 'success');
        else Utils.toast(pr.error || 'Print failed', 'error');
      } else {
        const pr = await API.printA4(html);
        if (!pr.success) await API.printPreview(html, title);
        else Utils.toast('Sent to printer', 'success');
      }
    } catch {
      await API.printPreview(html, title);
      Utils.toast('Print preview opened', 'success');
    }
    if (this.draft?.id) await this.recordFlyerAnalytics(this.draft.id, 'print');
  };

  window.__FLYER_STUDIO_LOADED__ = true;
})();
