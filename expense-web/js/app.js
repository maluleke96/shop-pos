const ExpenseApp = {
  view: 'login',
  _grantFlow: null,
  tab: 'new',
  token: ExpenseAPI.token(),
  user: null,
  settings: { shop_name: 'Shop POS', currency: 'R' },
  categories: [],
  expenses: [],
  _lineSeq: 2,
  form: {
    category: 'other',
    expense_date: '',
    notes: '',
    entryMode: 'stock',
    overheadName: '',
    overheadAmount: '',
    lineItems: [{ _id: 1, name: '', qty: '1', price: '' }],
    invoicePreview: '',
    invoiceDataUrl: '',
    payment_method: 'cash',
    funding_source: 'business',
    cash_source: 'today'
  },
  money: { from: '', to: '', branch_id: '', report: null, loading: false, error: '' },
  branches: [],
  ownerFundings: [],
  _loadingFunding: false,
  _fundingError: '',
  _saving: false,
  _loadingHistory: false,
  _historyError: '',
  historyDetail: null,
  _pendingKey: 'expense_pending_local',
  sbyView: 'list',
  sbyDetailId: null,
  sbyDash: null,
  sbyRows: [],
  sbyProducts: [],
  sbyDetail: null,
  sbyEvents: [],
  sbyForm: null,
  sbyWasteForm: null,
  _loadingBatches: false,
  _savingBatch: false,

  _hiddenAt: 0,
  _idleLockMs: 2 * 60 * 1000,

  /** Full-screen sheets left open block the whole app on phone — clear on startup and tab changes. */
  closeBlockingOverlays() {
    const pick = document.getElementById('exp-prod-pick');
    if (pick) {
      pick.classList.add('hidden');
      pick.innerHTML = '';
    }
    document.getElementById('exp-wd-overlay')?.remove();
  },

  init() {
    localStorage.removeItem('expense_token');
    localStorage.removeItem('expense_user');
    this.closeBlockingOverlays();
    this.user = ExpenseAPI.sessionUser();
    this.token = ExpenseAPI.token();
    this.form.expense_date = this.today();
    this.bindNav();
    this.bindLineItemActions();
    this.bindIdleLock();
    if (this.token && this.user) {
      this.view = 'main';
      this.bootstrap();
    } else {
      this.render();
    }
  },

  /** Leaving the app for a while returns to login; queued offline work stays and syncs under its user. */
  bindIdleLock() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this._hiddenAt = Date.now();
        return;
      }
      if (this.view === 'main' && this._hiddenAt && Date.now() - this._hiddenAt > this._idleLockMs) {
        this.lockToLogin('Signed out for safety — please sign in again.');
      }
      this._hiddenAt = 0;
    });
    window.addEventListener('pagehide', () => {
      if (this.view === 'main') this._hiddenAt = this._hiddenAt || Date.now();
    });
  },

  lockToLogin(message) {
    ExpenseAPI.clearSession();
    this.token = '';
    this.user = null;
    this.view = 'login';
    this.tab = 'new';
    this.historyDetail = null;
    this.resetForm();
    document.getElementById('exp-nav')?.classList.add('hidden');
    this.render();
    if (message) this.toast(message);
  },

  startSession(res) {
    ExpenseAPI.setSession(res.token, res.user);
    this.token = res.token;
    this.user = res.user;
  },

  today() {
    return new Date().toLocaleDateString('en-CA');
  },

  fmt(n) {
    const c = this.settings.currency || 'R';
    const val = Math.round((Number(n) || 0) * 100) / 100;
    return `${c}${val.toFixed(2)}`;
  },

  esc(s) {
    return String(s || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },

  toast(msg, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' error' : ''}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  },

  catIcon(cat) {
    return ({
      rent: '🏠', transport: '🚗', electricity: '⚡', salary: '💼',
      fuel: '⛽', maintenance: '🔧', other: '📋'
    }[cat] || '📋');
  },

  catLabel(cat) {
    return String(cat || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  },

  /** Searchable product / ingredient picker overlay for the expense app */
  openProductPicker(opts = {}) {
    const items = Array.isArray(opts.items) ? opts.items : (this.wasteProducts || this.catalog || []);
    const title = opts.title || 'Search product / ingredient';
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : () => {};
    if (!items.length) {
      this.toast(opts.emptyText || 'No products loaded yet', 'error');
      return;
    }
    document.getElementById('exp-prod-pick')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'exp-prod-pick';
    overlay.className = 'prod-pick-overlay';
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
    };
    const paint = (q = '') => {
      const list = overlay.querySelector('#exp-prod-pick-list');
      const count = overlay.querySelector('#exp-prod-pick-count');
      if (!list) return;
      const needle = String(q || '').trim().toLowerCase();
      const rows = items.filter((p) => {
        if (!needle) return true;
        const name = String(p.name || '').toLowerCase();
        const sku = String(p.sku || p.barcode || '').toLowerCase();
        return name.includes(needle) || sku.includes(needle);
      }).slice(0, 80);
      if (count) count.textContent = `${rows.length}`;
      list.innerHTML = rows.length
        ? rows.map((p) => {
          const stock = p.stock_quantity != null ? ` · ${p.stock_quantity} ${p.unit || ''}` : '';
          const type = p.item_type === 'ingredient' ? 'Ingredient' : (p.category_name || 'Product');
          return `<button type="button" class="prod-pick-row" data-id="${p.id}">
            <span><strong>${this.esc(p.name)}</strong><br><small class="muted">${this.esc(type)}${this.esc(stock)}</small></span>
            <span class="muted">Select</span>
          </button>`;
        }).join('')
        : '<p class="muted" style="padding:12px;margin:0">No matches</p>';
      list.querySelectorAll('.prod-pick-row').forEach((btn) => {
        btn.onclick = () => {
          const row = items.find((x) => String(x.id) === String(btn.dataset.id));
          if (!row) return;
          close();
          onPick(row);
        };
      });
    };
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="prod-pick-sheet">
        <div class="prod-pick-head">
          <strong>${this.esc(title)}</strong>
          <button type="button" class="btn btn-ghost" id="exp-prod-pick-x">×</button>
        </div>
        <p class="muted" style="margin:0 0 10px;font-size:0.85rem">Type to search, then tap an item.</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <input type="search" id="exp-prod-pick-q" placeholder="Search name…" style="flex:1" autocomplete="off">
          <span class="tag" id="exp-prod-pick-count">0</span>
        </div>
        <div id="exp-prod-pick-list" class="prod-pick-list"></div>
        <button type="button" class="btn btn-ghost" id="exp-prod-pick-cancel" style="margin-top:10px">Cancel</button>
      </div>`;
    paint('');
    overlay.querySelector('#exp-prod-pick-q')?.addEventListener('input', (e) => paint(e.target.value));
    overlay.querySelector('#exp-prod-pick-q')?.focus();
    overlay.querySelector('#exp-prod-pick-x')?.addEventListener('click', close);
    overlay.querySelector('#exp-prod-pick-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  },

  async ensureCatalog(force = false) {
    if (!force && this.catalog?.length) return this.catalog;
    if (!force && this._catalogLoad) return this._catalogLoad;
    this._catalogLoad = (async () => {
      try {
        const res = await ExpenseAPI.wasteProducts();
        const list = res?.success === false ? [] : (res?.data ?? res ?? []);
        this.catalog = Array.isArray(list) ? list.filter((p) => p.name !== '__Property Damage__') : [];
        this.wasteProducts = this.catalog;
      } catch (_) {
        this.catalog = this.catalog || [];
      }
      this._catalogLoad = null;
      return this.catalog;
    })();
    return this._catalogLoad;
  },

  parsePrice(v) {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  },

  validLineItems() {
    return (this.form.lineItems || [])
      .map((row) => {
        const name = String(row.name || '').trim();
        const quantity = Math.max(this.parsePrice(row.qty) || 0, 0.0001);
        const unit = String(row.unit || '').trim() || null;
        const amount = Math.round(this.parsePrice(row.price) * 100) / 100;
        const unit_price = quantity > 0 ? Math.round((amount / quantity) * 100) / 100 : 0;
        const out = {
          name,
          quantity,
          unit,
          unit_price,
          amount,
          line_total_mode: 'line',
          product_id: row.product_id || null
        };
        if (row.photo_data) out.photo_data = row.photo_data;
        if (row.photo_path) out.photo_path = row.photo_path;
        if (row.photo_url) out.photo_url = row.photo_url;
        return out;
      })
      .filter((row) => row.name && row.amount > 0);
  },

  calcTotal() {
    return Math.round(this.validLineItems().reduce((s, row) => s + (Number(row.amount) || 0), 0) * 100) / 100;
  },

  addLineItem() {
    this.form.lineItems.push({ _id: this._lineSeq++, name: '', qty: '1', unit: 'kg', price: '' });
    this.paintBody();
    setTimeout(() => {
      const rows = document.querySelectorAll('.line-item-name');
      rows[rows.length - 1]?.focus();
    }, 50);
  },

  removeLineItem(id) {
    const rid = String(id);
    if ((this.form.lineItems || []).length <= 1) {
      this.form.lineItems = [{ _id: this._lineSeq++, name: '', qty: '1', price: '' }];
    } else {
      this.form.lineItems = this.form.lineItems.filter((r) => String(r._id) !== rid);
    }
    this.paintBody();
  },

  bindLineItemActions() {
    if (this._lineActionsBound) return;
    this._lineActionsBound = true;
    document.getElementById('app')?.addEventListener('click', (e) => {
      const searchBtn = e.target.closest('.line-item-search');
      if (searchBtn && searchBtn.dataset.searchId != null) {
        e.preventDefault();
        e.stopPropagation();
        this.syncLineItemsFromDom();
        const lineId = searchBtn.dataset.searchId;
        const openPick = async () => {
          let catalog = await this.ensureCatalog().catch(() => []);
          if (!catalog.length) {
            this.toast('Loading products…', 'info');
            catalog = await this.ensureCatalog(true).catch(() => []);
          }
          if (!catalog.length) {
            this.toast('Could not load products — refresh and try again', 'error');
            return;
          }
          this.openProductPicker({
            items: catalog,
            title: 'Search product / ingredient',
            onPick: (row) => {
              const item = (this.form.lineItems || []).find((r) => String(r._id) === String(lineId));
              if (!item) return;
              item.name = row.name || '';
              item.product_id = row.id;
              const cost = Number(row.buying_price ?? row.cost_price ?? row.unit_cost ?? row.price);
              if (Number.isFinite(cost) && cost > 0 && !this.parsePrice(item.price)) {
                item.price = String(cost);
              }
              if (!item.qty) item.qty = '1';
              this.paintBody();
            }
          });
        };
        openPick();
        return;
      }
      const clearPhoto = e.target.closest('.line-item-photo-clear');
      if (clearPhoto?.dataset.photoClearId != null) {
        e.preventDefault();
        this.syncLineItemsFromDom();
        const item = (this.form.lineItems || []).find((r) => String(r._id) === String(clearPhoto.dataset.photoClearId));
        if (item) {
          item.photo_data = '';
          item.photo_url = '';
          item.photo_path = '';
          this.paintBody();
        }
        return;
      }
      const btn = e.target.closest('.line-item-remove');
      if (!btn || btn.dataset.removeId == null) return;
      e.preventDefault();
      e.stopPropagation();
      this.syncLineItemsFromDom();
      this.removeLineItem(btn.dataset.removeId);
    });
    document.getElementById('app')?.addEventListener('change', async (e) => {
      const input = e.target.closest?.('.line-item-photo-input');
      if (!input || input.dataset.photoId == null) return;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        this.syncLineItemsFromDom();
        const dataUrl = await this.fileToDataUrl(file);
        const item = (this.form.lineItems || []).find((r) => String(r._id) === String(input.dataset.photoId));
        if (!item) return;
        item.photo_data = dataUrl;
        this.paintBody();
        this.toast('Item photo attached');
      } catch (err) {
        this.toast(err.message || 'Could not attach photo', 'error');
      }
    });
  },

  slimSettings(raw) {
    const s = raw && typeof raw === 'object' ? { ...raw } : {};
    const logo = s.logo_path || s.logo_url || null;
    const blob = logo && String(logo).startsWith('data:');
    if (blob || (logo && String(logo).length > 512)) {
      s.has_logo = true;
      s.logo_path = null;
      s.logo_url = '/api/logo';
    } else if (logo && !s.logo_url) {
      s.has_logo = true;
      s.logo_url = String(logo).startsWith('http') ? logo : '/api/logo';
    }
    return s;
  },

  logoUrl() {
    if (this.settings?.has_logo || this.settings?.logo_url) {
      const u = this.settings.logo_url || '/api/logo';
      return String(u).startsWith('http') ? u : `${ExpenseAPI.origin()}${u.startsWith('/') ? u : `/${u}`}`;
    }
    const lp = this.settings?.logo_path;
    if (lp && String(lp).startsWith('http')) return lp;
    if (lp && !String(lp).startsWith('data:') && String(lp).length <= 512) {
      return `${ExpenseAPI.origin()}/api/logo`;
    }
    return '';
  },

  applyBranding() {
    const shop = this.settings?.shop_name || 'Expenses';
    document.title = `${shop} — Expenses`;
    const iconHref = this.logoUrl() || `${ExpenseAPI.origin()}/api/logo`;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = iconHref;
    let touch = document.querySelector('link[rel="apple-touch-icon"]');
    if (!touch) {
      touch = document.createElement('link');
      touch.rel = 'apple-touch-icon';
      document.head.appendChild(touch);
    }
    touch.href = link.href;
  },

  syncLineItemsFromDom() {
    document.querySelectorAll('.line-item-row').forEach((row) => {
      const id = row.dataset.id;
      const item = this.form.lineItems.find((r) => String(r._id) === String(id));
      if (!item) return;
      item.name = row.querySelector('.line-item-name')?.value || '';
      item.qty = row.querySelector('.line-item-qty')?.value || '1';
      item.unit = row.querySelector('.line-item-unit')?.value || item.unit || 'kg';
      item.price = row.querySelector('.line-item-price')?.value || '';
    });
  },

  updateTotalDisplay() {
    this.syncLineItemsFromDom();
    const el = document.getElementById('exp-total-display');
    if (el) el.textContent = this.fmt(this.calcTotal());
    const countEl = document.getElementById('exp-line-count');
    if (countEl) {
      const n = this.validLineItems().length;
      countEl.textContent = n ? `${n} item${n === 1 ? '' : 's'}` : 'Add items below';
    }
  },

  resetForm() {
    this._lineSeq = 2;
    this.form = {
      category: 'other',
      expense_date: this.today(),
      notes: '',
      entryMode: 'stock',
      overheadName: '',
      overheadAmount: '',
      lineItems: [{ _id: 1, name: '', qty: '1', price: '' }],
      invoicePreview: '',
      invoiceDataUrl: '',
      payment_method: 'cash',
      funding_source: 'business',
      cash_source: 'today'
    };
  },

  isOwnerOrManager() {
    return ['owner', 'manager'].includes(this.user?.role);
  },

  syncOwnerNav() {
    const show = this.isOwnerOrManager();
    document.querySelectorAll('#exp-nav .nav-owner-only').forEach((btn) => {
      btn.classList.toggle('hidden', !show);
    });
    if (!show && this.tab === 'funding') {
      this.tab = 'new';
      document.querySelectorAll('#exp-nav [data-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === 'new');
      });
    }
  },

  fundLabel(source) {
    return String(source || 'business').toLowerCase() === 'owner'
      ? 'Owner pocket'
      : 'Business';
  },

  cashSourceLabel(src) {
    return String(src || 'today').toLowerCase() === 'previous' ? "Previous days' money" : "Today's money";
  },

  cashSourceChips(id, value) {
    const prev = String(value || 'today') === 'previous';
    return `
      <div class="fund-chip-row cash-chip-row" id="${id}">
        <button type="button" class="fund-chip${!prev ? ' active' : ''}" data-cash="today">💵 Today's money</button>
        <button type="button" class="fund-chip${prev ? ' active' : ''}" data-cash="previous">🗄 Previous days' money</button>
      </div>
      <p class="muted" style="font-size:0.8rem;margin:6px 0 0;line-height:1.4"><strong>Today's money</strong> is deducted from today's takings in the daily money report. <strong>Previous</strong> = money kept from earlier days.</p>`;
  },

  async fileToDataUrl(file, maxW = 1400, quality = 0.82) {
    if (!file) return null;
    const looksImage = /^image\//.test(file.type || '') || (!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || ''));
    if (!looksImage) throw new Error('Please choose a photo (JPEG or PNG).');
    if (file.size > 40 * 1024 * 1024) throw new Error('Photo is too large. Use a photo under 40 MB.');
    const loadImg = (src) => new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read this photo. Try taking it again or choose a JPEG.'));
      el.src = src;
    });
    const blobUrl = URL.createObjectURL(file);
    try {
      let img;
      try {
        img = await loadImg(blobUrl);
      } catch (_) {
        const raw = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('Could not read this photo.'));
          fr.readAsDataURL(file);
        });
        img = await loadImg(raw);
      }
      // Fit the longest side so tall portrait shots stay small enough to upload on slow networks.
      const encode = (maxSide, q) => {
        const longest = Math.max(img.width, img.height) || 1;
        const scale = longest > maxSide ? maxSide / longest : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', q);
      };
      let out = encode(maxW, quality);
      if (out.length > 900 * 1024) out = encode(Math.min(maxW, 1100), 0.7);
      if (out.length > 900 * 1024) out = encode(900, 0.6);
      return out;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  },

  clearInvoice() {
    this.form.invoicePreview = '';
    this.form.invoiceDataUrl = '';
    this.paintBody();
  },

  switchTab(tab) {
    const btn = document.querySelector(`#exp-nav [data-tab="${tab}"]`);
    if (btn) btn.click();
  },

  bindNav() {
    if (this._navBound) return;
    this._navBound = true;
    window.addEventListener('expense-sync-failed', (e) => {
      this.toast(`An offline item could not be saved: ${e.detail?.error || 'rejected'}. See Profile → Sync.`, 'error');
    });
    window.addEventListener('online', () => this.updateSyncBadge());
    window.addEventListener('offline', () => this.updateSyncBadge());
    document.getElementById('exp-nav')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.tab = btn.dataset.tab;
      this.historyDetail = null;
      this.closeBlockingOverlays();
      if (this.tab !== 'batches') {
        this.sbyView = 'list';
        this.sbyDetailId = null;
        this.sbyDetail = null;
      }
      document.querySelectorAll('#exp-nav [data-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === this.tab);
      });
      this.paintBody();
      try {
        if (this.tab === 'history') await this.loadHistory(true);
        else if (this.tab === 'waste') await this.loadWaste(true);
        else if (this.tab === 'batches') await this.loadBatches(true);
        else if (this.tab === 'funding') await this.loadFunding(true);
        else if (this.tab === 'new') await this.ensureCatalog().catch(() => []);
      } catch (_) { /* paintBody shows error/empty states */ }
      this.paintBody();
    });
    window.addEventListener('portal-offline-flushed', (e) => {
      this.updateSyncBadge();
      if (this.view === 'main' && e.detail?.count) this.toast(`${e.detail.count} offline item(s) synced`);
      if (this.tab === 'history' && this.view === 'main') {
        this.loadHistory(true).then(() => this.paintBody()).catch(() => {});
      }
      if (this.tab === 'funding' && this.view === 'main') {
        this.loadFunding(true).then(() => this.paintBody()).catch(() => {});
      }
      if (this.tab === 'batches' && this.view === 'main') {
        this.loadBatches(true).then(() => this.paintBody()).catch(() => {});
      }
    });
  },

  getPendingExpenses() {
    try {
      const uid = this.user?.id;
      return JSON.parse(localStorage.getItem(this._pendingKey) || '[]')
        .filter((p) => !p.user_id || !uid || Number(p.user_id) === Number(uid));
    } catch (_) {
      return [];
    }
  },

  addPendingExpense(record) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(this._pendingKey) || '[]'); } catch (_) { list = []; }
    list.unshift({
      ...record,
      id: `local-${Date.now()}`,
      pending: true,
      user_id: this.user?.id || null,
      user_name: this.user?.full_name || this.user?.username || 'You'
    });
    localStorage.setItem(this._pendingKey, JSON.stringify(list.slice(0, 40)));
  },

  prunePendingExpenses(serverRows) {
    let pending = [];
    try { pending = JSON.parse(localStorage.getItem(this._pendingKey) || '[]'); } catch (_) { pending = []; }
    if (!pending.length || !serverRows?.length) return;
    const serverSigs = new Set(serverRows.map((e) =>
      `${e.expense_date}|${Number(e.amount).toFixed(2)}|${String(e.description || '').slice(0, 40)}`
    ));
    const kept = pending.filter((p) => {
      const sig = `${p.expense_date}|${Number(p.amount).toFixed(2)}|${String(p.description || p.notes || '').slice(0, 40)}`;
      return !serverSigs.has(sig);
    });
    localStorage.setItem(this._pendingKey, JSON.stringify(kept));
  },

  paintBody() {
    const body = document.getElementById('exp-body');
    const hdr = document.querySelector('.hdr-title h2');
    if (hdr) {
      if (this.historyDetail) hdr.textContent = 'Expense details';
      else if (this.tab === 'new') hdr.textContent = 'New expense';
      else if (this.tab === 'batches') {
        if (this.sbyView === 'create') hdr.textContent = 'New stock batch';
        else if (this.sbyView === 'waste') hdr.textContent = 'Batch waste';
        else if (this.sbyView === 'detail') hdr.textContent = 'Batch detail';
        else hdr.textContent = 'Stock batches';
      }
      else if (this.tab === 'waste') hdr.textContent = 'Waste / Damage';
      else if (this.tab === 'history') hdr.textContent = 'Recent expenses';
      else if (this.tab === 'funding') hdr.textContent = 'Daily money';
      else hdr.textContent = 'Your profile';
    }
    if (body) {
      body.innerHTML = this.renderBody();
      this.bindMain();
    }
  },

  async bootstrap() {
    this.closeBlockingOverlays();
    document.getElementById('exp-nav')?.classList.remove('hidden');
    this.view = 'main';
    this._bootstrapping = true;
    this.render();
    const bootTimeout = (p, ms) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connection timed out — check signal and try again')), ms))
    ]);
    try {
      const [settings, categories, profile, units] = await bootTimeout(Promise.all([
        ExpenseAPI.settings().catch(() => this.settings),
        ExpenseAPI.categories().catch(() => ['other']),
        ExpenseAPI.profile().catch(() => this.user),
        ExpenseAPI.unitsList().catch(() => [])
      ]), 28000);
      this.units = (units || []).map((u) => u.code || u).filter(Boolean);
      this.settings = this.slimSettings(settings || this.settings);
      this.categories = categories?.length ? categories : ['other'];
      this.user = profile || this.user;
      this.applyBranding();
      this.syncOwnerNav();
      ExpenseAPI.setSession(this.token, this.user);
      this.updateSyncBadge();
      if (this.tab === 'history') await this.loadHistory();
      if (this.tab === 'funding') await this.loadFunding();
    } catch (err) {
      this.token = '';
      this.user = null;
      ExpenseAPI.clearSession();
      this.view = 'login';
      document.getElementById('exp-nav')?.classList.add('hidden');
      this.toast(err.message || 'Session expired', 'error');
      this.render();
    } finally {
      this._bootstrapping = false;
      if (this.view === 'main') {
        this.paintBody();
        if (this.tab === 'new') {
          this.ensureCatalog().catch(() => []).then(() => this.paintBody());
        }
      }
    }
  },

  async loadHistory(force = false) {
    if (this._loadingHistory && !force) return;
    this._loadingHistory = true;
    this._historyError = '';
    try {
      const from = new Date();
      from.setDate(from.getDate() - 90);
      const data = await ExpenseAPI.list({
        from: from.toLocaleDateString('en-CA'),
        to: this.today(),
        limit: 100
      });
      const server = Array.isArray(data) ? data : (data?.rows || []);
      this.prunePendingExpenses(server);
      const pending = this.getPendingExpenses();
      this.expenses = [...pending, ...server];
    } catch (err) {
      this._historyError = err.message || 'Could not load expenses';
      this.expenses = this.getPendingExpenses();
      if (!this.expenses.length) this.toast(this._historyError, 'error');
    } finally {
      this._loadingHistory = false;
    }
  },

  render() {
    const app = document.getElementById('exp-nav');
    if (this.view === 'main') app?.classList.remove('hidden');
    else {
      app?.classList.add('hidden');
      this.closeBlockingOverlays();
    }
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = this.view === 'login' ? this.renderLogin() : this.renderShell();
    if (this.view === 'login') {
      this.bindLogin();
      if (this._grantFlow?.username) {
        const card = document.getElementById('epg-root');
        if (card) {
          card.innerHTML = ExpensePermissionGrant.render(this._grantFlow.username);
          const grantUser = this._grantFlow.username;
          const grantPass = this._grantFlow.password;
          ExpensePermissionGrant.bind(
            card,
            grantUser,
            grantPass,
            async (res) => {
              this._grantFlow = null;
              this.startSession(res);
              this.view = 'main';
              this.tab = 'new';
              await this.bootstrap();
              this.toast(`Permission granted — welcome, ${res.user?.full_name || grantUser}`);
            },
            () => {
              this._grantFlow = null;
              this.render();
            }
          );
        }
      }
    } else {
      this.syncOwnerNav();
      this.bindMain();
    }
  },

  showPermissionGrant(username, password) {
    this._grantFlow = { username, password };
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = `<div class="login-wrap"><div class="login-card" id="epg-root"></div></div>`;
    const card = document.getElementById('epg-root');
    card.innerHTML = ExpensePermissionGrant.render(username);
    ExpensePermissionGrant.bind(card, username, password, async (res) => {
      this._grantFlow = null;
      this.startSession(res);
      this.view = 'main';
      this.tab = 'new';
      await this.bootstrap();
      this.toast(`Permission granted — welcome, ${res.user?.full_name || username}`);
    }, () => {
      this._grantFlow = null;
      this.render();
    });
  },

  renderLogin() {
    if (this._grantFlow) {
      return `<div class="login-wrap"><div class="login-card" id="epg-root"></div></div>`;
    }
    return `
      <div class="login-wrap">
        <div class="login-card">
          <div class="brand-mark">₿</div>
          <h1>Expenses</h1>
          <p class="login-sub muted">Sign in with your shop account. Your administrator must grant you permission to capture expenses.</p>
          <form id="exp-login-form">
            <div class="field">
              <label for="exp-user">Username</label>
              <input id="exp-user" autocomplete="username" required placeholder="Your POS username">
            </div>
            <div class="field">
              <label for="exp-pass">Password</label>
              <input id="exp-pass" type="password" autocomplete="current-password" required placeholder="Your password">
            </div>
            <button type="submit" class="btn btn-primary" id="exp-login-btn">Sign in</button>
          </form>
        </div>
      </div>`;
  },

  renderShell() {
    const titles = {
      new: 'New expense',
      batches: 'Stock batches',
      waste: 'Waste / Damage',
      history: 'Recent expenses',
      funding: 'Daily money',
      profile: 'Your profile'
    };
    return `
      <header class="hdr">
        <div class="hdr-title">
          <h2>${titles[this.tab] || 'Expenses'}</h2>
          <p>${this.esc(this.settings.shop_name || 'Shop POS')}</p>
        </div>
        ${this.logoUrl() ? `<div class="shop-badge"><img src="${this.esc(this.logoUrl())}" alt="" onerror="this.style.display='none'"><span>${this.esc(this.settings.shop_name)}</span></div>` : ''}
      </header>
      <div id="exp-body">${this.renderBody()}</div>`;
  },

  renderBody() {
    if (this._bootstrapping) {
      return `<div class="empty"><div class="ico">⏳</div><p>Opening expenses…</p></div>`;
    }
    if (this.tab === 'history' && this.historyDetail) return this.renderDetail(this.historyDetail);
    if (this.tab === 'history') return this.renderHistory();
    if (this.tab === 'profile') return this.renderProfile();
    if (this.tab === 'batches') return this.renderBatches();
    if (this.tab === 'waste') return this.renderWaste();
    if (this.tab === 'funding') return this.renderFunding();
    return this.renderForm();
  },

  async loadBatches(force = false) {
    if (this._loadingBatches && !force) return;
    this._loadingBatches = true;
    try {
      const [dash, rows, products] = await Promise.all([
        ExpenseAPI.stockBatchDashboard({ status: 'open' }).catch(() => null),
        ExpenseAPI.stockBatchList({ status: 'open', limit: 80 }).catch(() => []),
        ExpenseAPI.stockBatchProducts().catch(() => [])
      ]);
      this.sbyDash = dash || {};
      this.sbyRows = Array.isArray(rows) ? rows : [];
      this.sbyProducts = Array.isArray(products) ? products : [];
      if (this.sbyView === 'detail' && this.sbyDetailId) {
        try {
          this.sbyDetail = await ExpenseAPI.stockBatchGet(this.sbyDetailId);
          this.sbyEvents = await ExpenseAPI.stockBatchEvents(this.sbyDetailId, 30).catch(() => []);
        } catch (_) { /* keep cached */ }
      }
    } catch (err) {
      this.toast(err.message || 'Could not load batches', 'error');
      this.sbyRows = this.sbyRows || [];
      this.sbyProducts = this.sbyProducts || [];
    } finally {
      this._loadingBatches = false;
    }
  },

  defaultSbyForm() {
    return {
      stock_product_id: '',
      stock_product_name: '',
      selling_product_id: '',
      selling_product_name: '',
      selling_price: '',
      purchase_cost: '',
      expected_yield: '',
      quantity_purchased: '',
      unit: 'kg',
      purchase_date: this.today(),
      supplier_name: '',
      invoice_ref: '',
      storage_location: '',
      notes: '',
      allocations: [],
      mealsUsing: []
    };
  },

  updateSbyPreview() {
    const cost = Number(document.getElementById('sby-cost')?.value) || 0;
    const el = document.getElementById('sby-preview');
    if (!el) return;
    const allocs = (this.sbyForm?.allocations || []).filter((a) => a.enabled !== false && a.selling_product_id);
    const plates = allocs.reduce((s, a) => s + (Number(a.expected_portions) || 0), 0)
      || Number(document.getElementById('sby-yield')?.value) || 0;
    el.textContent = `Purchase ${this.fmt(cost)}${plates ? ` · ~${plates} plates across meals` : ''}`;
  },

  syncSbyAllocFromDom() {
    this.sbyForm = this.sbyForm || this.defaultSbyForm();
    const meals = this.sbyForm.mealsUsing || [];
    this.sbyForm.allocations = meals.map((m) => {
      const on = document.querySelector(`.sby-alloc-on[data-meal-id="${m.id}"]`)?.checked;
      const kg = document.querySelector(`.sby-alloc-kg[data-meal-id="${m.id}"]`)?.value;
      const plates = document.querySelector(`.sby-alloc-plates[data-meal-id="${m.id}"]`)?.value;
      return {
        selling_product_id: m.id,
        selling_product_name: m.name,
        selling_price: m.selling_price,
        qty_kg: kg || '',
        expected_portions: plates || '',
        enabled: !!on
      };
    });
    const nameEl = document.getElementById('sby-stock-name');
    const costEl = document.getElementById('sby-cost');
    const qtyEl = document.getElementById('sby-qty');
    const unitEl = document.getElementById('sby-unit');
    const yieldEl = document.getElementById('sby-yield');
    if (nameEl) this.sbyForm.stock_product_name = nameEl.value;
    if (costEl) this.sbyForm.purchase_cost = costEl.value;
    if (qtyEl) this.sbyForm.quantity_purchased = qtyEl.value;
    if (unitEl) this.sbyForm.unit = unitEl.value;
    if (yieldEl) this.sbyForm.expected_yield = yieldEl.value;
  },

  renderBatches() {
    if (this.sbyView === 'create') return this.renderBatchCreate();
    if (this.sbyView === 'waste') return this.renderBatchWaste();
    if (this.sbyView === 'detail') return this.renderBatchDetail();
    if (this._loadingBatches && !this.sbyRows?.length && !this.sbyDash) {
      return `<div class="empty"><div class="ico">⏳</div><p>Loading batches…</p></div>`;
    }
    const d = this.sbyDash || {};
    const rows = this.sbyRows || [];
    const list = rows.length
      ? rows.map((b) => {
        const over = (Number(b.portions_sold) || 0) > (Number(b.expected_yield) || 0);
        const pct = Math.min(100, Number(b.progress_pct) || 0);
        return `
          <button type="button" class="form-card sby-row-btn" data-sby-id="${b.id}" style="width:100%;text-align:left;padding:12px;margin-bottom:8px;cursor:pointer;border:1px solid var(--border);background:var(--card)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div>
                <strong>${this.esc(b.batch_number || `#${b.id}`)}</strong>
                <div style="font-size:0.9rem;margin-top:2px">${this.esc(b.stock_product_name || 'Stock')}</div>
                <div class="muted" style="font-size:0.8rem">→ ${this.esc(b.selling_product_name || '—')}</div>
              </div>
              <span class="tag" style="background:#1e1b4b;color:#c7d2fe;font-size:0.72rem">${this.esc(b.status_label || b.status || '')}</span>
            </div>
            <div class="muted" style="font-size:0.8rem;margin-top:8px">
              ${this.fmt(b.purchase_cost)} · sold ${b.portions_sold || 0}/${b.expected_yield || 0}
              · rem ${b.remaining ?? '—'} · profit ${this.fmt(b.gross_profit)}
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:999px;margin-top:8px;overflow:hidden">
              <i style="display:block;height:100%;width:${pct}%;background:${over ? '#f59e0b' : '#10b981'};border-radius:999px"></i>
            </div>
          </button>`;
      }).join('')
      : `<div class="empty" style="padding:20px"><p class="muted">No open stock batches yet</p></div>`;

    return `
      <div class="form-card" style="margin-bottom:12px">
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">Report a purchase as a stock batch from your phone. Sales on POS update yield automatically — desktop sees the same batches.</p>
        <button type="button" class="btn btn-primary" id="sby-new" style="width:100%">+ Create stock batch</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div class="form-card" style="padding:10px"><div class="muted" style="font-size:0.72rem">Active</div><strong>${d.active_batches || 0}</strong></div>
        <div class="form-card" style="padding:10px"><div class="muted" style="font-size:0.72rem">Purchase cost</div><strong>${this.fmt(d.total_purchase_cost)}</strong></div>
        <div class="form-card" style="padding:10px"><div class="muted" style="font-size:0.72rem">Revenue</div><strong>${this.fmt(d.revenue_generated)}</strong></div>
        <div class="form-card" style="padding:10px"><div class="muted" style="font-size:0.72rem">Gross profit</div><strong>${this.fmt(d.estimated_gross_profit)}</strong></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:0.9rem">Open batches</strong>
        <button type="button" class="btn btn-ghost" id="sby-refresh" style="padding:6px 10px;font-size:0.8rem">Refresh</button>
      </div>
      ${list}`;
  },

  renderBatchCreate() {
    const f = this.sbyForm || this.defaultSbyForm();
    const cost = Number(f.purchase_cost) || 0;
    const allocs = Array.isArray(f.allocations) ? f.allocations : [];
    const meals = Array.isArray(f.mealsUsing) ? f.mealsUsing : [];
    const expectedSum = allocs.reduce((s, a) => s + (Number(a.expected_portions) || 0), 0)
      || Number(f.expected_yield) || 0;
    const allocHtml = meals.length
      ? meals.map((m) => {
        const a = allocs.find((x) => String(x.selling_product_id) === String(m.id)) || {};
        const on = a.selling_product_id != null || a.enabled;
        return `
          <div class="form-card" style="padding:10px;margin-bottom:8px;border:1px solid var(--border)">
            <label style="display:flex;gap:8px;align-items:flex-start;margin:0">
              <input type="checkbox" class="sby-alloc-on" data-meal-id="${m.id}" ${on ? 'checked' : ''} style="margin-top:4px">
              <span>
                <strong>${this.esc(m.name)}</strong>
                <div class="muted" style="font-size:0.75rem">Recipe uses ${m.recipe_qty || '?'} ${this.esc(m.recipe_unit || '')} · sell ${this.fmt(m.selling_price)}</div>
              </span>
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;${on ? '' : 'opacity:0.45;pointer-events:none'}">
              <div class="field" style="margin:0"><label style="font-size:0.72rem">kg / qty from this purchase</label>
                <input type="number" class="sby-alloc-kg" data-meal-id="${m.id}" step="0.001" min="0" value="${this.esc(a.qty_kg || '')}" placeholder="e.g. 3"></div>
              <div class="field" style="margin:0"><label style="font-size:0.72rem">Expected plates</label>
                <input type="number" class="sby-alloc-plates" data-meal-id="${m.id}" step="0.01" min="0" value="${this.esc(a.expected_portions || '')}" placeholder="plates"></div>
            </div>
          </div>`;
      }).join('')
      : `<p class="muted" style="font-size:0.85rem">Pick a stock item from the catalog to see meals that use it in Recipe &amp; Production. You can still save with expected yield only.</p>`;

    return `
      <div class="form-card">
        <button type="button" class="btn btn-ghost" id="sby-back" style="margin-bottom:12px">← Back to list</button>
        <div class="field">
          <label>Stock / ingredient purchased</label>
          <input type="hidden" id="sby-stock-id" value="${this.esc(f.stock_product_id || '')}">
          <button type="button" class="btn btn-ghost" id="sby-stock-pick" style="width:100%;justify-content:space-between;text-align:left;margin-bottom:8px">
            <span>${f.stock_product_name ? this.esc(f.stock_product_name) : 'Pick from catalog (recommended)'}</span>
            <span>▾</span>
          </button>
          <input id="sby-stock-name" placeholder="e.g. Potatoes 10kg" value="${this.esc(f.stock_product_name || '')}">
        </div>
        <div class="field"><label>Purchase cost (total paid)</label>
          <input id="sby-cost" type="number" step="0.01" min="0" inputmode="decimal" value="${this.esc(f.purchase_cost || '')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="field"><label>Qty purchased</label>
            <input id="sby-qty" type="number" step="0.001" min="0" value="${this.esc(f.quantity_purchased || '')}"></div>
          <div class="field"><label>Unit</label>
            <input id="sby-unit" value="${this.esc(f.unit || 'kg')}"></div>
        </div>
        <div class="field"><label>Expected yield (total plates) <span class="muted">optional if set per meal below</span></label>
          <input id="sby-yield" type="number" step="0.01" min="0" inputmode="decimal" value="${this.esc(f.expected_yield || expectedSum || '')}"></div>
        <div class="field"><label>Purchase date</label>
          <input id="sby-date" type="date" value="${this.esc(f.purchase_date || this.today())}"></div>
        <p class="section-label" style="margin-top:16px">Meals that use this stock</p>
        <p class="muted" style="font-size:0.8rem;margin:0 0 10px">Tick each meal (chips, quarter, etc.) and enter how many kg from this purchase go to that meal. POS sales deduct via Recipe &amp; Production.</p>
        <div id="sby-alloc-list">${allocHtml}</div>
        <div class="field"><label>Supplier</label>
          <input id="sby-supplier" value="${this.esc(f.supplier_name || '')}" placeholder="Optional"></div>
        <div class="field"><label>Notes</label>
          <input id="sby-notes" value="${this.esc(f.notes || '')}" placeholder="Optional"></div>
        <p class="muted" id="sby-preview" style="font-size:0.8rem;margin:0 0 12px">Purchase ${this.fmt(cost)}${expectedSum ? ` · ~${expectedSum} plates across meals` : ''}</p>
        <button type="button" class="btn btn-primary" id="sby-save" style="width:100%;margin-top:8px" ${this._savingBatch ? 'disabled' : ''}>
          ${this._savingBatch ? 'Saving…' : 'Save stock batch'}
        </button>
      </div>`;
  },

  renderBatchDetail() {
    const b = this.sbyDetail;
    if (!b) {
      return `<div class="empty"><p class="muted">Batch not found</p>
        <button type="button" class="btn btn-ghost" id="sby-back">← Back</button></div>`;
    }
    const closed = b.status === 'finished' || b.status === 'cancelled';
    const events = Array.isArray(this.sbyEvents) ? this.sbyEvents : [];
    const evHtml = events.length
      ? events.slice(0, 20).map((e) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:0.82rem">
            <strong>${this.esc(e.action || e.event_type || e.type || '')}</strong>
            <div class="muted">${this.esc(e.user_name || '')} · ${this.esc(String(e.created_at || '').slice(0, 16))}</div>
            ${e.reason || e.notes ? `<div class="muted">${this.esc(e.reason || e.notes || '')}</div>` : ''}
          </div>`).join('')
      : `<p class="muted" style="font-size:0.85rem">No events yet</p>`;
    return `
      <div class="form-card">
        <button type="button" class="btn btn-ghost" id="sby-back" style="margin-bottom:10px">← Back to list</button>
        <h3 style="margin:0 0 4px;font-size:1.05rem">${this.esc(b.batch_number || '')}</h3>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">${this.esc(b.stock_product_name)} → ${this.esc(b.selling_product_name || '—')}</p>
        <span class="tag" style="background:#1e1b4b;color:#c7d2fe">${this.esc(b.status_label || b.status)}</span>
        ${(Array.isArray(b.allocations) && b.allocations.length) ? `
          <div style="margin:12px 0;padding:10px;border:1px solid var(--border);border-radius:10px">
            <strong style="font-size:0.85rem">Meal allocations</strong>
            ${b.allocations.map((a) => `
              <div class="muted" style="font-size:0.8rem;margin-top:6px">
                ${this.esc(a.selling_product_name || '#' + a.selling_product_id)}
                · ${a.qty_kg || 0} kg/qty · ${a.expected_portions || 0} plates
              </div>`).join('')}
          </div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0">
          <div><div class="muted" style="font-size:0.72rem">Purchase</div><strong>${this.fmt(b.purchase_cost)}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Cost / portion</div><strong>${this.fmt(b.cost_per_portion)}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Sold / expected</div><strong>${b.portions_sold || 0} / ${b.expected_yield || 0}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Remaining</div><strong>${b.remaining ?? '—'}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Revenue</div><strong>${this.fmt(b.revenue)}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Gross profit</div><strong>${this.fmt(b.gross_profit)}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Waste</div><strong>${b.portions_wasted || 0}</strong></div>
          <div><div class="muted" style="font-size:0.72rem">Sell price</div><strong>${this.fmt(b.selling_price)}</strong></div>
        </div>
        ${!closed ? `
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
            <button type="button" class="btn btn-primary" id="sby-d-waste">Record waste</button>
            <button type="button" class="btn btn-ghost" id="sby-d-actual">Set actual yield</button>
            <button type="button" class="btn btn-ghost" id="sby-d-close">Close / finish batch</button>
          </div>` : ''}
        <strong style="font-size:0.9rem">Activity</strong>
        <div style="margin-top:8px">${evHtml}</div>
      </div>`;
  },

  renderBatchWaste() {
    const b = this.sbyDetail;
    const f = this.sbyWasteForm || { quantity: '1', reason: 'Damaged', notes: '' };
    return `
      <div class="form-card">
        <button type="button" class="btn btn-ghost" id="sby-back-detail" style="margin-bottom:12px">← Back to batch</button>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">
          Waste against <strong>${this.esc(b?.batch_number || '')}</strong> — ${this.esc(b?.stock_product_name || '')}.
          Remaining: <strong>${b?.remaining ?? '—'}</strong>
        </p>
        <div class="field"><label>Portions wasted</label>
          <input id="sby-w-qty" type="number" step="0.01" min="0" value="${this.esc(f.quantity || '1')}"></div>
        <div class="field"><label>Reason</label>
          <select id="sby-w-reason">
            ${['Damaged', 'Spoiled', 'Overcooked', 'Dropped', 'Other'].map((r) =>
              `<option ${f.reason === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Notes</label>
          <input id="sby-w-notes" value="${this.esc(f.notes || '')}" placeholder="Optional"></div>
        <button type="button" class="btn btn-primary" id="sby-w-save" style="width:100%">Submit waste</button>
      </div>`;
  },

  async loadWaste(force = false) {
    if (this._loadingWaste && !force) return;
    this._loadingWaste = true;
    try {
      const [products, pending] = await Promise.all([
        ExpenseAPI.wasteProducts().catch(() => []),
        ExpenseAPI.wasteList({ status: 'pending' }).catch(() => [])
      ]);
      this.wasteProducts = Array.isArray(products) ? products : [];
      this.wastePending = Array.isArray(pending) ? pending : [];
    } catch (err) {
      this.toast(err.message || 'Could not load waste', 'error');
      this.wasteProducts = this.wasteProducts || [];
      this.wastePending = this.wastePending || [];
    } finally {
      this._loadingWaste = false;
    }
  },

  renderWaste() {
    if (this._loadingWaste && !this.wasteProducts) {
      return `<div class="empty"><div class="ico">⏳</div><p>Loading…</p></div>`;
    }
    const products = this.wasteProducts || [];
    const pending = this.wastePending || [];
    const kind = this.wasteForm?.kind || 'ingredient';
    const pendingHtml = pending.length
      ? pending.map((w) => `
        <div class="form-card" style="padding:12px;margin-bottom:8px">
          <strong>${this.esc(w.product_name || w.property_name || 'Item')}</strong>
          <div class="muted" style="font-size:0.85rem">${this.esc(w.reason || '')} · qty ${w.quantity}</div>
          <span class="tag" style="background:#78350f;color:#fde68a">Pending approval</span>
        </div>`).join('')
      : `<div class="empty" style="padding:16px"><p class="muted">No pending waste reports</p></div>`;

    return `
      <div class="form-card">
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">Report damaged stock or company property with a photo. Admin must approve before stock is deducted.</p>
        <div class="field"><label>Type</label>
          <select id="w-kind">
            <option value="ingredient" ${kind === 'ingredient' ? 'selected' : ''}>Product / Ingredient</option>
            <option value="property" ${kind === 'property' ? 'selected' : ''}>Company property</option>
          </select>
        </div>
        <div class="field" id="w-prod-wrap" style="${kind === 'property' ? 'display:none' : ''}">
          <label>Product / Ingredient</label>
          <input type="hidden" id="w-prod" value="${this.esc(this.wasteForm?.product_id || '')}">
          <button type="button" class="btn btn-ghost" id="w-prod-pick" style="width:100%;justify-content:space-between;text-align:left">
            <span id="w-prod-lbl">${this.wasteForm?.product_name
              ? this.esc(this.wasteForm.product_name)
              : 'Search &amp; select product / ingredient…'}</span>
            <span>🔍</span>
          </button>
          <p class="muted" style="margin:6px 0 0;font-size:0.8rem">${products.length} items — tap to search</p>
        </div>
        <div class="field" id="w-prop-wrap" style="${kind === 'property' ? '' : 'display:none'}">
          <label>What was damaged?</label>
          <input id="w-prop" placeholder="e.g. Broken fridge door" value="${this.esc(this.wasteForm?.property_name || '')}">
        </div>
        <div class="field"><label>Quantity</label>
          <input id="w-qty" type="number" step="0.001" min="0" value="${this.esc(this.wasteForm?.quantity || '1')}"></div>
        <div class="field"><label>Unit</label>
          <select id="w-unit">${(this.units || ['kg', 'g', 'L', 'mL', 'each']).map((u) => `<option ${(this.wasteForm?.unit || 'kg') === u ? 'selected' : ''}>${this.esc(u)}</option>`).join('')}</select></div>
        <div class="field"><label>Reason</label>
          <select id="w-reason">
            ${['Damaged', 'Spoiled', 'Expired', 'Broken', 'Lost', 'Other'].map((r) =>
              `<option ${this.wasteForm?.reason === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Notes</label>
          <input id="w-notes" value="${this.esc(this.wasteForm?.notes || '')}" placeholder="Optional"></div>
        <p class="section-label">Photo (required)</p>
        ${this.wasteForm?.photoPreview ? `
          <div class="invoice-preview-wrap">
            <img src="${this.wasteForm.photoPreview}" alt="Damage" class="invoice-preview">
            <button type="button" class="btn btn-ghost" id="w-photo-clear">Remove</button>
          </div>` : `
          <div class="invoice-actions">
            <label class="invoice-btn">
              <span class="invoice-btn-ico">📷</span><span>Take photo</span>
              <input type="file" id="w-photo-cam" accept="image/*" capture="environment" hidden>
            </label>
            <label class="invoice-btn secondary">
              <span class="invoice-btn-ico">🖼</span><span>Upload</span>
              <input type="file" id="w-photo-file" accept="image/*" hidden>
            </label>
          </div>`}
        <button type="button" class="btn btn-primary" id="w-save" style="margin-top:14px">${this._savingWaste ? 'Submitting…' : 'Submit for approval'}</button>
      </div>
      <p class="section-label" style="margin-top:20px">Your pending reports</p>
      ${pendingHtml}`;
  },

  renderLineItems() {
    return (this.form.lineItems || []).map((row, idx) => `
      <div class="line-item-row" data-id="${row._id}">
        <div class="line-item-num">${idx + 1}</div>
        <div class="line-item-fields">
          <div class="line-item-name-wrap">
            <input type="text" class="line-item-name" placeholder="Item / ingredient" value="${this.esc(row.name)}" autocomplete="off">
            <button type="button" class="line-item-search" data-search-id="${row._id}" aria-label="Search product">🔍</button>
          </div>
          <input type="number" class="line-item-qty" placeholder="Qty" inputmode="decimal" step="any" min="0" value="${this.esc(row.qty != null ? row.qty : '1')}">
          <select class="line-item-unit">${(this.units || ['kg', 'g', 'L', 'mL', 'each']).map((u) => `<option ${(row.unit || 'kg') === u ? 'selected' : ''}>${this.esc(u)}</option>`).join('')}</select>
          <input type="number" class="line-item-price" placeholder="Unit cost" inputmode="decimal" step="0.01" min="0" value="${this.esc(row.price)}">
          <div class="line-item-photo-wrap">
            ${row.photo_data || row.photo_url
              ? `<img class="line-item-thumb" src="${this.esc(row.photo_data || row.photo_url)}" alt="">
                 <button type="button" class="line-item-photo-clear" data-photo-clear-id="${row._id}">Remove photo</button>`
              : `<label class="line-item-cam" title="Take photo of this item">
                   <span>📷</span>
                   <input type="file" class="line-item-photo-input" data-photo-id="${row._id}" accept="image/*" capture="environment" hidden>
                 </label>`}
          </div>
        </div>
        <button type="button" class="line-item-remove" data-remove-id="${row._id}" aria-label="Remove line">×</button>
      </div>`).join('');
  },

  renderForm() {
    const cats = (this.categories.length ? this.categories : ['other']).map((c) => `
      <button type="button" class="cat-chip${this.form.category === c ? ' active' : ''}" data-cat="${this.esc(c)}">${this.catIcon(c)} ${this.catLabel(c)}</button>
    `).join('');
    const total = this.calcTotal();
    const validCount = this.validLineItems().length;

    return `
      ${this.isOwnerOrManager() ? `
      <div class="quick-actions">
        <button type="button" class="qa-btn qa-withdraw" data-open-withdrawal>💸<span>Money withdrawal</span></button>
        <button type="button" class="qa-btn" data-goto-money>📊<span>Today's money</span></button>
      </div>` : ''}
      <div class="form-card" style="margin-bottom:12px">
        <p class="section-label" style="margin-top:0">Expense type</p>
        <div class="fund-chip-row" id="exp-mode-chips">
          <button type="button" class="fund-chip${this.form.entryMode !== 'overhead' ? ' active' : ''}" data-exp-mode="stock">📦 Stock / materials</button>
          <button type="button" class="fund-chip${this.form.entryMode === 'overhead' ? ' active' : ''}" data-exp-mode="overhead">🏢 Bill / overhead</button>
        </div>
        <p class="muted" style="font-size:0.8rem;margin:8px 0 0;line-height:1.4">Use <strong>Bill / overhead</strong> for rent, electricity and other costs with no unit of measure.</p>
      </div>

      <div class="form-card line-items-card" id="exp-stock-block" style="${this.form.entryMode === 'overhead' ? 'display:none' : ''}">
        <div class="line-items-head">
          <p class="section-label" style="margin:0">Invoice line items</p>
          <span class="muted" id="exp-line-count">${validCount ? `${validCount} item${validCount === 1 ? '' : 's'}` : 'Add items below'}</span>
        </div>
        <p class="muted line-items-hint">Search or type the item, enter <strong>qty</strong> and <strong>price paid</strong> yourself (no auto-multiply). Tap 📷 on each line to photo that ingredient.</p>
        <div class="line-items-columns"><span>Item</span><span>Qty</span><span>Price</span><span>Photo</span></div>
        <div id="exp-line-list">${this.renderLineItems()}</div>
        <button type="button" class="btn btn-add-line" id="exp-add-line">+ Add another item</button>
      </div>

      <div class="form-card" id="exp-overhead-block" style="${this.form.entryMode === 'overhead' ? '' : 'display:none'}">
        <div class="field">
          <label for="exp-overhead-name">What is this bill for?</label>
          <input id="exp-overhead-name" placeholder="e.g. Shop rent — October" value="${this.esc(this.form.overheadName || '')}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="exp-overhead-amount">Amount paid</label>
          <input id="exp-overhead-amount" type="number" step="0.01" min="0" placeholder="0.00" value="${this.esc(this.form.overheadAmount || '')}">
        </div>
      </div>

      <div class="amount-hero amount-hero-total">
        <label>Invoice total</label>
        <div class="amount-total-display" id="exp-total-display">${this.fmt(this.form.entryMode === 'overhead' ? (parseFloat(this.form.overheadAmount) || 0) : total)}</div>
        <p class="muted amount-total-note">${this.form.entryMode === 'overhead' ? 'Bill amount (no qty / unit)' : 'Sum of prices you entered (qty is not multiplied)'}</p>
      </div>

      <p class="section-label">Category</p>
      <div class="cat-grid" id="exp-cats">${cats}</div>

      <div class="form-card">
        <div class="field">
          <label for="exp-date">Date</label>
          <input id="exp-date" type="date" value="${this.esc(this.form.expense_date || this.today())}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="exp-notes">Supplier / note <span class="muted">(optional)</span></label>
          <input id="exp-notes" placeholder="e.g. Makro, Shell, landlord…" value="${this.esc(this.form.notes)}">
          <label for="exp-payment">Payment method</label>
          <select id="exp-payment">
            <option value="cash" ${this.form.payment_method === 'cash' ? 'selected' : ''}>Cash</option>
            <option value="card" ${this.form.payment_method === 'card' ? 'selected' : ''}>Card</option>
            <option value="eft" ${this.form.payment_method === 'eft' ? 'selected' : ''}>EFT / Bank transfer</option>
            <option value="other" ${this.form.payment_method === 'other' ? 'selected' : ''}>Other</option>
          </select>
          <label style="margin-top:12px">Who paid? (funding source)</label>
          <div class="fund-chip-row" id="exp-fund-chips">
            <button type="button" class="fund-chip${this.form.funding_source !== 'owner' ? ' active' : ''}" data-fund="business">Business money</button>
            <button type="button" class="fund-chip${this.form.funding_source === 'owner' ? ' active' : ''}" data-fund="owner">My pocket (owner)</button>
          </div>
          <p class="muted" style="font-size:0.8rem;margin:6px 0 0;line-height:1.4">Choose <strong>My pocket</strong> when you paid with personal money so Admin records it as owner funding.</p>
          <div id="exp-cash-source-wrap" class="${this.form.funding_source === 'owner' ? 'hidden' : ''}">
            <label style="margin-top:12px">Which money was used?</label>
            ${this.cashSourceChips('exp-cash-chips', this.form.cash_source)}
          </div>
        </div>
      </div>

      <div class="form-card invoice-card">
        <p class="section-label" style="margin-top:0">Invoice photo</p>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">After listing items, take a photo or upload the full invoice below, then submit everything together.</p>
        ${this.form.invoicePreview ? `
          <div class="invoice-preview-wrap">
            <img src="${this.form.invoicePreview}" alt="Invoice preview" class="invoice-preview">
            <button type="button" class="btn btn-ghost invoice-remove" id="exp-invoice-clear">Remove photo</button>
          </div>` : `
          <div class="invoice-actions">
            <label class="invoice-btn">
              <span class="invoice-btn-ico">📷</span>
              <span>Take photo</span>
              <input type="file" id="exp-invoice-camera" accept="image/*" capture="environment" hidden>
            </label>
            <label class="invoice-btn secondary">
              <span class="invoice-btn-ico">🖼</span>
              <span>Upload file</span>
              <input type="file" id="exp-invoice-file" accept="image/*" hidden>
            </label>
          </div>`}
      </div>

      <button type="button" class="btn btn-primary" id="exp-save-btn">${this._saving ? 'Submitting…' : 'Submit expense'}</button>
      <p class="muted" style="text-align:center;margin-top:12px;line-height:1.45">Line items, total, and invoice photo are sent together to Admin → Expenses and accounting.</p>`;
  },

  renderLineItemsSummary(items) {
    if (!items?.length) return '';
    return `<ul class="line-items-summary">${items.map((r) => {
      const photo = (r.photo_url || r.photo_data)
        ? `<img src="${this.esc(r.photo_url || r.photo_data)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px;margin-right:6px;vertical-align:middle">`
        : '';
      return `<li><span>${photo}${this.esc(r.name)} <small>qty ${Number(r.quantity) || 1} · paid ${this.fmt(r.unit_price || r.amount)}</small></span><strong>${this.fmt(r.amount)}</strong></li>`;
    }).join('')}</ul>`;
  },

  renderDetail(e) {
    const items = e.line_items || [];
    const lines = items.length ? items.map((r) => `
      <div class="detail-line">
        <div style="display:flex;gap:8px;align-items:center">
          ${(r.photo_url || r.photo_path) ? `<img src="${this.esc(r.photo_url || r.photo_path)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px">` : ''}
          <div><strong>${this.esc(r.name)}</strong><br><span class="muted">qty ${Number(r.quantity) || 1} · paid ${this.fmt(r.unit_price)}</span></div>
        </div>
        <strong>${this.fmt(r.amount)}</strong>
      </div>`).join('') : `<p class="muted">${this.esc(e.description || 'No line items')}</p>`;

    return `
      <button type="button" class="btn btn-ghost" id="exp-detail-back" style="width:auto;margin-bottom:12px">← Back to list</button>
      <div class="form-card">
        <p class="muted" style="margin:0 0 4px">${this.esc(e.expense_date || '')} · ${this.catLabel(e.category)}</p>
        <h3 style="margin:0 0 8px">${this.fmt(Number(e.amount) || 0)}</h3>
        ${e.description ? `<p class="muted" style="margin:0">${this.esc(e.description)}</p>` : ''}
        <p style="margin:10px 0 0">
          <span class="${String(e.funding_source || '').toLowerCase() === 'owner' ? 'exp-fund-owner' : 'exp-fund-biz'}">
            Funded by ${this.fundLabel(e.funding_source)}
          </span>
        </p>
        <p class="muted" style="margin:8px 0 0;font-size:0.85rem">By ${this.esc(e.user_name || '—')}</p>
      </div>
      <div class="form-card">
        <p class="section-label" style="margin-top:0">Line items</p>
        ${lines}
        <div class="detail-line detail-total"><span>Total</span><strong>${this.fmt(Number(e.amount) || items.reduce((s, r) => s + (Number(r.amount) || 0), 0))}</strong></div>
      </div>
      ${this.invoiceSrc(e) ? `
      <div class="form-card invoice-card">
        <p class="section-label" style="margin-top:0">Invoice photo</p>
        <a href="${this.esc(this.invoiceSrc(e))}" target="_blank" rel="noopener">
          <img src="${this.esc(this.invoiceSrc(e))}" alt="Invoice" class="invoice-preview">
        </a>
      </div>` : '<p class="muted" style="text-align:center">No invoice photo</p>'}`;
  },

  invoiceSrc(e) {
    if (!e) return '';
    const raw = e.invoice_url || e.invoice_data || '';
    if (raw && String(raw).startsWith('data:')) return raw;
    if (raw && /^https?:\/\//i.test(raw)) return raw;
    const id = e.id;
    if (id && !String(id).startsWith('local-') && (raw || e.invoice_path || e.has_invoice)) {
      if (raw && String(raw).startsWith('/')) return `${ExpenseAPI.origin()}${raw}`;
      return ExpenseAPI.invoiceUrl(id);
    }
    return '';
  },

  invoiceThumbHtml(e) {
    const src = this.invoiceSrc(e);
    if (!src) return `<span class="exp-item-icon">${this.catIcon(e.category)}</span>`;
    return `<span class="exp-item-thumb"><img src="${this.esc(src)}" alt="Invoice"></span>`;
  },

  expenseTitle(e) {
    if (e.line_items?.length) {
      const names = e.line_items.slice(0, 2).map((r) => r.name).filter(Boolean);
      if (names.length) return names.join(', ') + (e.line_items.length > 2 ? ` +${e.line_items.length - 2}` : '');
    }
    return e.description || e.notes || this.catLabel(e.category);
  },

  renderHistory() {
    if (this._loadingHistory) {
      return `<div class="empty"><div class="ico">⏳</div><p>Loading your expenses…</p></div>`;
    }
    const mine = this.expenses || [];
    const total = mine.reduce((s, e) => s + Number(e.amount || 0), 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthFrom = monthStart.toLocaleDateString('en-CA');
    const monthTotal = mine.filter((e) => String(e.expense_date || '') >= monthFrom)
      .reduce((s, e) => s + Number(e.amount || 0), 0);

    const list = mine.length ? mine.map((e) => {
      const title = this.expenseTitle(e);
      const pending = e.pending ? '<span class="tag" style="background:#78350f;color:#fde68a;margin-left:6px">Pending sync</span>' : '';
      return `
      <button type="button" class="exp-item exp-item-btn" data-exp-id="${this.esc(String(e.id))}" data-exp-pending="${e.pending ? '1' : '0'}">
        ${this.invoiceThumbHtml(e)}
        <span class="exp-item-body">
          <span class="exp-item-top">
            <strong>${this.esc(title)}</strong>
            <span class="exp-amount">${this.fmt(Number(e.amount) || 0)}</span>
          </span>
          ${this.renderLineItemsSummary(e.line_items)}
          <span class="exp-meta">${this.esc(e.expense_date || '')}${e.user_name ? ` · ${this.esc(e.user_name)}` : ''}${e.branch_name ? ` · ${this.esc(e.branch_name)}` : ''}</span>
          <span class="tag">${this.catLabel(e.category)}</span>${pending}
          <span class="${String(e.funding_source || '').toLowerCase() === 'owner' ? 'exp-fund-owner' : 'exp-fund-biz'}" style="margin-left:6px">${this.fundLabel(e.funding_source)}</span>
          ${String(e.funding_source || '').toLowerCase() !== 'owner' && e.cash_source ? `<span class="exp-fund-biz" style="margin-left:6px">${this.cashSourceLabel(e.cash_source)}</span>` : ''}
          <span class="invoice-link">Tap to view full details →</span>
        </span>
      </button>`;
    }).join('') : `<div class="empty"><div class="ico">📭</div><p>${this._historyError ? this.esc(this._historyError) : 'No expenses in the last 90 days.'}</p></div>`;

    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
        <button type="button" class="btn btn-ghost" id="exp-history-refresh" style="width:auto;padding:8px 14px;font-size:0.85rem">↻ Refresh</button>
      </div>
      <div class="summary-row">
        <div class="stat-card"><span>Last 90 days</span><strong>${this.fmt(total)}</strong></div>
        <div class="stat-card"><span>This month</span><strong>${this.fmt(monthTotal)}</strong></div>
      </div>
      ${list}`;
  },

  renderProfile() {
    const initials = (this.user?.full_name || this.user?.username || '?').trim().slice(0, 1).toUpperCase();
    return `
      <div class="profile-card">
        <div class="avatar">${this.esc(initials)}</div>
        <h3>${this.esc(this.user?.full_name || 'User')}</h3>
        <p class="muted">@${this.esc(this.user?.username || '')}</p>
      </div>
      <div class="info-list">
        <div class="info-row"><span>Role</span><span>${this.esc(this.user?.role || '—')}</span></div>
        <div class="info-row"><span>Permission</span><span>Expense capture</span></div>
        <div class="info-row"><span>Recorded as</span><span>${this.esc(this.user?.full_name || this.user?.username)}</span></div>
      </div>
      <div class="form-card" id="exp-sync-card">${this.renderSyncCard()}</div>
      <button type="button" class="btn btn-danger" id="exp-logout-btn">Sign out</button>
      <p class="muted" style="text-align:center;margin-top:10px;font-size:0.8rem">For safety the app signs out when closed or left for 2 minutes. Offline work is kept and syncs under your name.</p>`;
  },

  renderSyncCard() {
    const pending = this._pendingCount || 0;
    const failed = ExpenseAPI.syncFailures();
    const online = navigator.onLine;
    return `
      <p class="section-label" style="margin-top:0">Sync</p>
      <div class="info-row"><span>Connection</span><span class="${online ? 'ok-text' : 'warn-text'}">${online ? 'Online' : 'Offline'}</span></div>
      <div class="info-row"><span>Waiting to sync</span><span>${pending}</span></div>
      ${pending && online ? '<button type="button" class="btn btn-ghost" id="exp-sync-now" style="width:100%;margin-top:8px">↻ Sync now</button>' : ''}
      ${failed.length ? `
        <p class="section-label" style="margin-top:14px">Could not be saved (${failed.length})</p>
        ${failed.slice(0, 8).map((f) => `
          <div class="sync-fail">
            <strong>${this.esc(f.summary || f.method.replace('expenseApp:', ''))}${f.amount ? ` · ${this.fmt(f.amount)}` : ''}</strong>
            <span>${this.esc(f.error)}</span>
          </div>`).join('')}
        <button type="button" class="btn btn-ghost" id="exp-sync-clear" style="width:100%">Clear list (re-enter these items)</button>` : ''}`;
  },

  async updateSyncBadge() {
    this._pendingCount = await ExpenseAPI.pendingCount();
    const card = document.getElementById('exp-sync-card');
    if (card) {
      card.innerHTML = this.renderSyncCard();
      this.bindSyncCard();
    }
    const btn = document.querySelector('#exp-nav [data-tab="profile"]');
    if (btn) {
      let dot = btn.querySelector('.sync-dot');
      if (this._pendingCount > 0) {
        if (!dot) { dot = document.createElement('span'); dot.className = 'sync-dot'; btn.appendChild(dot); }
        dot.textContent = String(this._pendingCount);
      } else if (dot) dot.remove();
    }
  },

  bindSyncCard() {
    document.getElementById('exp-sync-now')?.addEventListener('click', async () => {
      await ExpenseAPI.flushQueue().catch(() => {});
      this.updateSyncBadge();
    });
    document.getElementById('exp-sync-clear')?.addEventListener('click', () => {
      ExpenseAPI.clearSyncFailures();
      this.updateSyncBadge();
    });
  },

  async loadFunding(force = false) {
    if (!this.isOwnerOrManager()) {
      this.ownerFundings = [];
      return;
    }
    if (this._loadingFunding && !force) return;
    this._loadingFunding = true;
    this._fundingError = '';
    try {
      const from = new Date();
      from.setDate(1);
      const [data] = await Promise.all([
        ExpenseAPI.ownerFundings({
          from: from.toLocaleDateString('en-CA'),
          to: this.today(),
          limit: 100
        }),
        this.loadHistory(force).catch(() => {}),
        this.loadMoney().catch(() => {})
      ]);
      this.ownerFundings = Array.isArray(data) ? data : (data?.rows || []);
    } catch (err) {
      this._fundingError = err.message || 'Could not load funding';
      this.ownerFundings = [];
      this.toast(this._fundingError, 'error');
    } finally {
      this._loadingFunding = false;
    }
  },

  renderFunding() {
    if (!this.isOwnerOrManager()) {
      return `<div class="empty"><div class="ico">🔒</div><p>Daily money is only available to owners and managers.</p></div>`;
    }
    return `${this.renderMoney()}<p class="section-label" style="margin-top:22px">Owner funding</p>${this.renderOwnerFunding()}`;
  },

  moneyRange() {
    const m = this.money;
    if (!m.from) m.from = this.today();
    if (!m.to) m.to = m.from;
    return { from: m.from, to: m.to, branch_id: m.branch_id || 'all' };
  },

  async loadMoney() {
    if (!this.isOwnerOrManager()) return;
    const m = this.money;
    m.loading = true;
    m.error = '';
    try {
      if (!this.branches.length && this.user?.role === 'owner') {
        this.branches = await ExpenseAPI.branches().catch(() => []);
      }
      m.report = await ExpenseAPI.dailyMoney(this.moneyRange());
    } catch (err) {
      m.error = err.message || 'Could not load daily money';
    } finally {
      m.loading = false;
    }
  },

  renderMoney() {
    const m = this.money;
    const r = m.report;
    const t = r?.totals || {};
    const range = this.moneyRange();
    const single = range.from === range.to;
    const branchOpts = this.user?.role === 'owner' && this.branches.length > 1
      ? `<div class="field"><label for="exp-m-branch">Branch / POS</label>
          <select id="exp-m-branch">
            <option value="all"${range.branch_id === 'all' ? ' selected' : ''}>All stores</option>
            ${this.branches.map((b) => `<option value="${b.id}"${String(range.branch_id) === String(b.id) ? ' selected' : ''}>${this.esc(b.name)}</option>`).join('')}
          </select></div>` : '';
    const wds = r?.withdrawals || [];
    const byBranch = r?.by_branch || [];
    return `
      <div class="quick-actions">
        <button type="button" class="qa-btn qa-withdraw" data-open-withdrawal>💸<span>Money withdrawal</span></button>
        <button type="button" class="qa-btn" id="exp-m-today">📅<span>Today</span></button>
      </div>
      <div class="form-card">
        <div class="range-row">
          <div class="field"><label for="exp-m-from">From</label><input id="exp-m-from" type="date" value="${this.esc(range.from)}"></div>
          <div class="field"><label for="exp-m-to">To</label><input id="exp-m-to" type="date" value="${this.esc(range.to)}"></div>
        </div>
        ${branchOpts}
        <button type="button" class="btn btn-ghost" id="exp-m-load" style="width:100%">↻ Show report</button>
      </div>
      ${m.loading ? '<div class="empty"><div class="ico">⏳</div><p>Loading daily money…</p></div>' : m.error ? `<div class="empty"><div class="ico">⚠</div><p>${this.esc(m.error)}</p></div>` : r ? `
      <div class="money-hero">
        <span>${single ? (range.from === this.today() ? "Today's" : this.esc(range.from)) : `${this.esc(range.from)} → ${this.esc(range.to)}`} · ${r.branch ? this.esc(r.branch.name) : 'All stores'}</span>
        <div class="money-grid">
          <div><label>Money in</label><strong class="ok-text">${this.fmt(t.money_in)}</strong></div>
          <div><label>Out of today's money</label><strong class="warn-text">${this.fmt(t.out_today)}</strong></div>
          <div class="money-net"><label>Net today's money</label><strong>${this.fmt(t.net_today)}</strong></div>
        </div>
      </div>
      <div class="info-list">
        <div class="info-row"><span>Cash · Card · EFT</span><span>${this.fmt(t.cash_in)} · ${this.fmt(t.card_in)} · ${this.fmt(t.eft_in)}</span></div>
        <div class="info-row"><span>Expenses (today's money)</span><span>${this.fmt(t.expenses_today)}</span></div>
        <div class="info-row"><span>Withdrawals (today's money)</span><span>${this.fmt(t.withdrawals_today)}</span></div>
        <div class="info-row"><span>Paid from previous money</span><span>${this.fmt((t.expenses_previous || 0) + (t.withdrawals_previous || 0))}</span></div>
        <div class="info-row"><span>Owner pocket expenses</span><span>${this.fmt(t.expenses_owner)}</span></div>
        <div class="info-row"><span>Sales</span><span>${t.sale_count || 0}</span></div>
      </div>
      ${byBranch.length ? `<p class="section-label">By branch</p>${byBranch.map((b) => `
        <div class="info-row branch-row"><span>${this.esc(b.branch_name)}</span><span>in ${this.fmt(b.totals.money_in)} · out ${this.fmt(b.totals.out_today)} · <strong>${this.fmt(b.totals.net_today)}</strong></span></div>`).join('')}` : ''}
      <div class="report-actions">
        <button type="button" class="rep-btn" id="exp-m-pdf">📄<span>PDF</span></button>
        <button type="button" class="rep-btn" id="exp-m-wa">🟢<span>WhatsApp owner</span></button>
        <button type="button" class="rep-btn" id="exp-m-print">🖨<span>Print</span></button>
      </div>
      <p class="section-label">Withdrawals${wds.length ? ` (${wds.length})` : ''}</p>
      ${wds.length ? wds.map((w) => `
        <div class="form-card wd-card">
          <div style="display:flex;justify-content:space-between;gap:8px"><strong>${this.fmt(w.amount)}</strong><span class="tag">${this.cashSourceLabel(w.cash_source)}</span></div>
          <p class="muted" style="margin:6px 0 0;font-size:0.85rem">${this.esc(w.withdrawal_date)} · ${this.esc(w.purpose || '')}</p>
          <p class="muted" style="margin:4px 0 0;font-size:0.8rem">Taken by ${this.esc(w.taken_by || '—')} · Given by ${this.esc(w.given_by || '—')} · Authorised by ${this.esc(w.authorised_by || '—')}</p>
        </div>`).join('') : '<p class="muted" style="margin:0 0 12px">No withdrawals in this period.</p>'}` : ''}`;
  },

  bindMoney() {
    const reload = async () => {
      const from = document.getElementById('exp-m-from')?.value || this.today();
      const to = document.getElementById('exp-m-to')?.value || from;
      this.money.from = from <= to ? from : to;
      this.money.to = from <= to ? to : from;
      this.money.branch_id = document.getElementById('exp-m-branch')?.value || this.money.branch_id || 'all';
      this.money.loading = true;
      this.paintBody();
      await this.loadMoney();
      this.paintBody();
    };
    document.getElementById('exp-m-load')?.addEventListener('click', reload);
    document.getElementById('exp-m-branch')?.addEventListener('change', reload);
    document.getElementById('exp-m-today')?.addEventListener('click', () => {
      const f = document.getElementById('exp-m-from');
      const t = document.getElementById('exp-m-to');
      if (f) f.value = this.today();
      if (t) t.value = this.today();
      reload();
    });
    document.getElementById('exp-m-pdf')?.addEventListener('click', () => this.reportPdf());
    document.getElementById('exp-m-wa')?.addEventListener('click', () => this.reportWhatsApp());
    document.getElementById('exp-m-print')?.addEventListener('click', () => this.reportPrint());
    this.bindSyncCard();
  },

  async fetchReportPdf() {
    const out = await ExpenseAPI.dailyMoneyPdf(this.moneyRange());
    if (!out?.base64) throw new Error('Could not build the PDF');
    const bin = atob(out.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: out.filename || 'daily-money.pdf' };
  },

  async reportPdf() {
    try {
      this.toast('Preparing PDF…');
      const { blob, filename } = await this.fetchReportPdf();
      const file = typeof File !== 'undefined' ? new File([blob], filename, { type: 'application/pdf' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename }).catch(() => {});
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      this.toast(err.message || 'Could not create PDF', 'error');
    }
  },

  reportText() {
    const r = this.money.report;
    if (!r) return '';
    const t = r.totals;
    const shop = r.shop?.shop_name || this.settings.shop_name || 'Shop';
    const period = r.from === r.to ? r.from : `${r.from} to ${r.to}`;
    const lines = [
      `*${shop} — Daily money*`,
      `${r.branch ? `Branch: ${r.branch.name}` : 'All stores'} · ${period}`,
      '',
      `Money in: ${this.fmt(t.money_in)} (cash ${this.fmt(t.cash_in)}, card ${this.fmt(t.card_in)}, EFT ${this.fmt(t.eft_in)})`,
      `Expenses from today's money: ${this.fmt(t.expenses_today)}`,
      `Withdrawals from today's money: ${this.fmt(t.withdrawals_today)}`,
      `*Net today's money: ${this.fmt(t.net_today)}*`,
      `Paid from previous money: ${this.fmt((t.expenses_previous || 0) + (t.withdrawals_previous || 0))}`,
      `Owner pocket expenses: ${this.fmt(t.expenses_owner)}`
    ];
    (r.by_branch || []).forEach((b) => lines.push(`• ${b.branch_name}: in ${this.fmt(b.totals.money_in)}, out ${this.fmt(b.totals.out_today)}, net ${this.fmt(b.totals.net_today)}`));
    if ((r.withdrawals || []).length) {
      lines.push('', '*Withdrawals*');
      r.withdrawals.slice(0, 15).forEach((w) => lines.push(`• ${w.withdrawal_date} ${this.fmt(w.amount)} — ${w.purpose} (taken: ${w.taken_by}, given: ${w.given_by}, authorised: ${w.authorised_by}; ${this.cashSourceLabel(w.cash_source)})`));
    }
    lines.push('', `Sent by ${this.user?.full_name || this.user?.username || ''}`);
    return lines.join('\n');
  },

  async reportWhatsApp() {
    if (!this.money.report) return this.toast('Load the report first', 'error');
    const saved = localStorage.getItem('expense_owner_wa') || this.money.report.owner_whatsapp || '';
    const phone = window.prompt("Owner's WhatsApp number", saved);
    if (phone == null) return;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 9) return this.toast('Enter a valid WhatsApp number', 'error');
    localStorage.setItem('expense_owner_wa', phone);
    const num = digits.startsWith('0') ? `27${digits.slice(1)}` : digits;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(this.reportText())}`;
    const w = window.open(url, '_blank');
    if (!w) location.href = url;
  },

  reportHtml() {
    const r = this.money.report;
    const t = r.totals;
    const s = r.shop || this.settings || {};
    const e = (v) => this.esc(v);
    const period = r.from === r.to ? r.from : `${r.from} to ${r.to}`;
    const logo = s.logo_path ? `<img src="${e(ExpenseAPI.origin())}/api/logo" style="height:56px;width:auto;border-radius:8px" onerror="this.remove()">` : '';
    const row = (k, v, strong) => `<tr${strong ? ' class="strong"' : ''}><td>${k}</td><td class="r">${this.fmt(v)}</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Daily money ${e(period)}</title>
      <style>body{font-family:Segoe UI,Arial,sans-serif;color:#111;margin:24px}h1{margin:0;font-size:20px}
      .hd{display:flex;gap:14px;align-items:center;border-bottom:2px solid #312e81;padding-bottom:10px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}th{background:#312e81;color:#fff;text-align:left;padding:6px}
      td{padding:5px 6px;border-bottom:1px solid #e5e7eb}.r{text-align:right}.strong td{font-weight:700;background:#e0e7ff}.m{color:#555;font-size:12px}</style></head>
      <body><div class="hd">${logo}<div><h1>${e(s.shop_name || 'Shop')}</h1>
      <div class="m">${r.branch ? `Branch: ${e(r.branch.name)}${r.branch.address ? ` · ${e(r.branch.address)}` : ''}${r.branch.phone ? ` · Tel ${e(r.branch.phone)}` : ''}` : 'All stores'}</div>
      <div class="m">${e(s.address || '')}${s.phone ? ` · Tel ${e(s.phone)}` : ''}${s.vat_number ? ` · VAT ${e(s.vat_number)}` : ''}</div></div></div>
      <h2 style="font-size:16px;margin:0">Daily Money Report — ${e(period)}</h2>
      <div class="m">Printed ${e(new Date().toLocaleString())} by ${e(this.user?.full_name || this.user?.username || '')}</div>
      <table><tr><th>Summary</th><th class="r">Amount</th></tr>
      ${row('Money in (sales takings)', t.money_in)}${row('&nbsp;&nbsp;Cash', t.cash_in)}${row('&nbsp;&nbsp;Card', t.card_in)}${row('&nbsp;&nbsp;EFT', t.eft_in)}
      ${row("Expenses from today's money", t.expenses_today)}${row("Withdrawals from today's money", t.withdrawals_today)}
      ${row("NET today's money", t.net_today, true)}${row("Expenses from previous money", t.expenses_previous)}${row("Withdrawals from previous money", t.withdrawals_previous)}
      ${row('Owner pocket expenses', t.expenses_owner)}${row('Owner cash put in', t.owner_cash_in)}</table>
      ${r.days.length > 1 ? `<table><tr><th>Date</th><th class="r">Money in</th><th class="r">Out (today)</th><th class="r">Net</th></tr>
        ${r.days.map((d) => `<tr><td>${e(d.date)}</td><td class="r">${this.fmt(d.money_in)}</td><td class="r">${this.fmt(d.out_today)}</td><td class="r">${this.fmt(d.net_today)}</td></tr>`).join('')}</table>` : ''}
      ${(r.by_branch || []).length ? `<table><tr><th>Branch</th><th class="r">Money in</th><th class="r">Out (today)</th><th class="r">Net</th></tr>
        ${r.by_branch.map((b) => `<tr><td>${e(b.branch_name)}</td><td class="r">${this.fmt(b.totals.money_in)}</td><td class="r">${this.fmt(b.totals.out_today)}</td><td class="r">${this.fmt(b.totals.net_today)}</td></tr>`).join('')}</table>` : ''}
      ${(r.withdrawals || []).length ? `<table><tr><th>Date</th><th class="r">Amount</th><th>Purpose</th><th>Taken by</th><th>Given by</th><th>Authorised</th><th>Money</th></tr>
        ${r.withdrawals.map((w) => `<tr><td>${e(w.withdrawal_date)}</td><td class="r">${this.fmt(w.amount)}</td><td>${e(w.purpose)}</td><td>${e(w.taken_by)}</td><td>${e(w.given_by)}</td><td>${e(w.authorised_by)}</td><td>${e(this.cashSourceLabel(w.cash_source))}</td></tr>`).join('')}</table>` : ''}
      </body></html>`;
  },

  reportPrint() {
    if (!this.money.report) return this.toast('Load the report first', 'error');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(this.reportHtml());
    doc.close();
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (_) {
        this.reportPdf();
      }
      setTimeout(() => frame.remove(), 60000);
    }, 600);
  },

  openWithdrawalSheet() {
    if (!this.isOwnerOrManager()) return this.toast('Only owners and managers can record withdrawals', 'error');
    document.getElementById('exp-wd-overlay')?.remove();
    const me = this.user?.full_name || this.user?.username || '';
    const wrap = document.createElement('div');
    wrap.id = 'exp-wd-overlay';
    wrap.className = 'prod-pick-overlay';
    wrap.innerHTML = `
      <div class="prod-pick-sheet wd-sheet" role="dialog" aria-label="Money withdrawal">
        <div class="prod-pick-head"><strong>💸 Money withdrawal</strong><button type="button" class="btn btn-ghost" data-wd-close>✕</button></div>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">Owner / manager drawing. It is deducted in accounting (Owner Drawings) and in the daily money report.</p>
        <div class="range-row">
          <div class="field"><label for="wd-amt">Amount</label><input id="wd-amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
          <div class="field"><label for="wd-date">Date</label><input id="wd-date" type="date" value="${this.esc(this.today())}"></div>
        </div>
        <div class="field"><label for="wd-purpose">Purpose</label><input id="wd-purpose" placeholder="e.g. Owner personal use, wages advance"></div>
        <div class="field"><label for="wd-taken">Who took the money</label><input id="wd-taken" placeholder="Name"></div>
        <div class="field"><label for="wd-given">Who gave the money</label><input id="wd-given" value="${this.esc(me)}"></div>
        <div class="field"><label for="wd-auth">Who authorised it</label><input id="wd-auth" placeholder="Name"></div>
        <div class="field"><label>From which money?</label>${this.cashSourceChips('wd-cash-chips', 'today')}</div>
        <div class="field"><label for="wd-method">Paid as</label>
          <select id="wd-method"><option value="cash">Cash from till</option><option value="eft">EFT / bank</option></select></div>
        <button type="button" class="btn btn-primary" id="wd-save">Record withdrawal</button>
      </div>`;
    document.body.appendChild(wrap);
    let cashSource = 'today';
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-wd-close]')) close(); });
    wrap.querySelector('#wd-cash-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cash]');
      if (!chip) return;
      cashSource = chip.dataset.cash === 'previous' ? 'previous' : 'today';
      wrap.querySelectorAll('#wd-cash-chips .fund-chip').forEach((c) => c.classList.toggle('active', c.dataset.cash === cashSource));
    });
    wrap.querySelector('#wd-save')?.addEventListener('click', async () => {
      const val = (id) => (wrap.querySelector(id)?.value || '').trim();
      const amount = parseFloat(val('#wd-amt'));
      if (!(amount > 0)) return this.toast('Enter the amount', 'error');
      if (!val('#wd-purpose')) return this.toast('Enter the purpose', 'error');
      if (!val('#wd-taken') || !val('#wd-given') || !val('#wd-auth')) return this.toast('Fill in who took, who gave and who authorised', 'error');
      const btn = wrap.querySelector('#wd-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const res = await ExpenseAPI.recordWithdrawal({
          amount,
          withdrawal_date: val('#wd-date') || this.today(),
          purpose: val('#wd-purpose'),
          taken_by: val('#wd-taken'),
          given_by: val('#wd-given'),
          authorised_by: val('#wd-auth'),
          cash_source: cashSource,
          payment_method: val('#wd-method') || 'cash',
          branch_id: this.money.branch_id && this.money.branch_id !== 'all' ? this.money.branch_id : undefined
        });
        close();
        this.toast(res?.__offlineQueued ? 'Withdrawal saved offline — will sync when online' : `Withdrawal of ${this.fmt(amount)} recorded`);
        this.updateSyncBadge();
        if (this.tab === 'funding') {
          await this.loadMoney();
          this.paintBody();
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Record withdrawal';
        this.toast(err.message || 'Could not record withdrawal', 'error');
      }
    });
    setTimeout(() => wrap.querySelector('#wd-amt')?.focus(), 50);
  },

  renderOwnerFunding() {
    if (this._loadingFunding) {
      return `<div class="empty"><div class="ico">⏳</div><p>Loading funding…</p></div>`;
    }
    const funds = this.ownerFundings || [];
    const total = funds.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const ownerExps = (this.expenses || []).filter(
      (e) => String(e.funding_source || '').toLowerCase() === 'owner'
    );
    const list = funds.length ? funds.map((f) => `
      <div class="form-card" style="padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <strong>${this.fmt(Number(f.amount) || 0)}</strong>
          <span class="tag">${f.funding_type === 'cash_injection' ? 'Cash in' : 'Purchase'}</span>
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:0.85rem">${this.esc(f.funding_date || '')} · ${this.esc(f.description || '—')}</p>
        <p class="muted" style="margin:4px 0 0;font-size:0.8rem">By ${this.esc(f.created_by_name || '—')}</p>
      </div>`).join('') : `<div class="empty"><div class="ico">💼</div><p>${this._fundingError ? this.esc(this._fundingError) : 'No owner funding this month yet.'}</p></div>`;

    return `
      <div class="form-card">
        <p style="margin:0 0 10px;line-height:1.45">When you buy with <strong>your own money</strong>, mark the expense as <em>My pocket</em>. Use the form below only when you put cash into the till or bank (not for purchases).</p>
        <div class="summary-row" style="margin-bottom:12px">
          <div class="stat-card"><span>Funding this month</span><strong>${this.fmt(total)}</strong></div>
          <div class="stat-card"><span>Owner-funded expenses</span><strong>${ownerExps.length}</strong></div>
        </div>
        <div class="field">
          <label for="exp-of-date">Date</label>
          <input id="exp-of-date" type="date" value="${this.esc(this.today())}">
        </div>
        <div class="field">
          <label for="exp-of-amt">Amount</label>
          <input id="exp-of-amt" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00">
        </div>
        <div class="field">
          <label for="exp-of-desc">Description</label>
          <input id="exp-of-desc" placeholder="Cash into till / bank deposit">
        </div>
        <button type="button" class="btn btn-primary" id="exp-of-save">Record cash injection</button>
      </div>
      <p class="section-label">This month’s funding ledger</p>
      ${list}`;
  },

  bindLogin() {
    document.getElementById('exp-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('exp-login-btn');
      const username = document.getElementById('exp-user')?.value?.trim();
      const password = document.getElementById('exp-pass')?.value || '';
      if (!username || !password) return this.toast('Enter username and password', 'error');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const device = {
          device_name: navigator.userAgent?.slice(0, 80) || 'phone',
          platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'android'
        };
        const res = await ExpenseAPI.login(username, password, device);
        this.startSession(res);
        this.view = 'main';
        this.tab = 'new';
        await this.bootstrap();
        this.toast(`Welcome, ${res.user?.full_name || username}`);
      } catch (err) {
        const msg = err.message || 'Login failed';
        if (/permission|not allowed|expense/i.test(msg)) {
          this.showPermissionGrant(username, password);
          return;
        }
        this.toast(msg, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
  },

  bindMain() {
    document.getElementById('exp-cats')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      this.form.category = chip.dataset.cat;
      document.querySelectorAll('#exp-cats .cat-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.cat === this.form.category);
      });
    });

    document.getElementById('exp-mode-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-exp-mode]');
      if (!chip) return;
      this.form.entryMode = chip.dataset.expMode === 'overhead' ? 'overhead' : 'stock';
      if (this.form.entryMode === 'overhead') {
        const rent = (this.categories || []).find((c) => /rent/i.test(c));
        if (rent) this.form.category = rent;
      }
      this.paintBody();
    });

    document.getElementById('exp-fund-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-fund]');
      if (!chip) return;
      this.form.funding_source = chip.dataset.fund === 'owner' ? 'owner' : 'business';
      document.querySelectorAll('#exp-fund-chips .fund-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.fund === this.form.funding_source);
      });
      document.getElementById('exp-cash-source-wrap')?.classList.toggle('hidden', this.form.funding_source === 'owner');
    });

    document.getElementById('exp-cash-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cash]');
      if (!chip) return;
      this.form.cash_source = chip.dataset.cash === 'previous' ? 'previous' : 'today';
      document.querySelectorAll('#exp-cash-chips .fund-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.cash === this.form.cash_source);
      });
    });

    document.querySelectorAll('[data-open-withdrawal]').forEach((b) => {
      b.addEventListener('click', () => this.openWithdrawalSheet());
    });
    document.querySelectorAll('[data-goto-money]').forEach((b) => {
      b.addEventListener('click', () => this.switchTab('funding'));
    });
    this.bindMoney();

    document.getElementById('exp-date')?.addEventListener('change', (e) => {
      this.form.expense_date = e.target.value;
    });
    document.getElementById('exp-notes')?.addEventListener('input', (e) => {
      this.form.notes = e.target.value;
    });
    document.getElementById('exp-payment')?.addEventListener('change', (e) => {
      this.form.payment_method = e.target.value;
    });

    document.getElementById('exp-line-list')?.addEventListener('input', () => this.updateTotalDisplay());
    document.getElementById('exp-add-line')?.addEventListener('click', () => this.addLineItem());

    document.getElementById('exp-invoice-camera')?.addEventListener('change', (e) => this.handleInvoicePick(e.target));
    document.getElementById('exp-invoice-file')?.addEventListener('change', (e) => this.handleInvoicePick(e.target));
    document.getElementById('exp-invoice-clear')?.addEventListener('click', () => this.clearInvoice());

    document.getElementById('exp-save-btn')?.addEventListener('click', () => this.saveExpense());
    document.getElementById('exp-logout-btn')?.addEventListener('click', () => this.logout());

    document.getElementById('exp-of-save')?.addEventListener('click', async () => {
      if (this._savingFunding) return;
      const amount = parseFloat(document.getElementById('exp-of-amt')?.value || '0');
      if (!(amount > 0)) return this.toast('Enter an amount', 'error');
      this._savingFunding = true;
      const btn = document.getElementById('exp-of-save');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        const res = await ExpenseAPI.recordOwnerFunding({
          funding_date: document.getElementById('exp-of-date')?.value || this.today(),
          amount,
          funding_type: 'cash_injection',
          description: document.getElementById('exp-of-desc')?.value?.trim() || 'Owner cash into business'
        });
        this.updateSyncBadge();
        this.toast(res?.__offlineQueued ? 'Saved offline — will sync when online' : 'Owner cash injection recorded');
        await this.loadFunding(true);
        this.paintBody();
      } catch (err) {
        this.toast(err.message || 'Could not record funding', 'error');
      } finally {
        this._savingFunding = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Record cash injection'; }
      }
    });

    document.getElementById('exp-detail-back')?.addEventListener('click', () => {
      this.historyDetail = null;
      this.paintBody();
    });

    document.getElementById('exp-history-refresh')?.addEventListener('click', async () => {
      await this.loadHistory(true);
      this.paintBody();
    });

    document.getElementById('w-kind')?.addEventListener('change', (e) => {
      this.wasteForm = this.wasteForm || {};
      this.wasteForm.kind = e.target.value;
      const prop = e.target.value === 'property';
      const pw = document.getElementById('w-prod-wrap');
      const rw = document.getElementById('w-prop-wrap');
      if (pw) pw.style.display = prop ? 'none' : '';
      if (rw) rw.style.display = prop ? '' : 'none';
    });
    document.getElementById('w-prod-pick')?.addEventListener('click', async () => {
      await this.ensureCatalog();
      this.openProductPicker({
        items: this.wasteProducts || this.catalog || [],
        title: 'Select product / ingredient',
        onPick: (row) => {
          this.wasteForm = this.wasteForm || {};
          this.wasteForm.product_id = row.id;
          this.wasteForm.product_name = row.name;
          const hid = document.getElementById('w-prod');
          const lbl = document.getElementById('w-prod-lbl');
          if (hid) hid.value = row.id;
          if (lbl) lbl.textContent = `${row.name} (${row.stock_quantity ?? 0} ${row.unit || ''})`;
        }
      });
    });
    const pickWastePhoto = async (input) => {
      const file = input?.files?.[0];
      if (input) input.value = '';
      if (!file) return;
      try {
        const dataUrl = await this.fileToDataUrl(file);
        this.wasteForm = this.wasteForm || {};
        this.wasteForm.photoPreview = dataUrl;
        this.wasteForm.photo_image = dataUrl;
        this.paintBody();
        this.toast('Photo attached');
      } catch (err) {
        this.toast(err.message || 'Could not attach photo', 'error');
      }
    };
    document.getElementById('w-photo-cam')?.addEventListener('change', (e) => pickWastePhoto(e.target));
    document.getElementById('w-photo-file')?.addEventListener('change', (e) => pickWastePhoto(e.target));
    document.getElementById('w-photo-clear')?.addEventListener('click', () => {
      this.wasteForm = this.wasteForm || {};
      this.wasteForm.photoPreview = '';
      this.wasteForm.photo_image = '';
      this.paintBody();
    });
    document.getElementById('w-save')?.addEventListener('click', async () => {
      if (this._savingWaste) return;
      this.wasteForm = this.wasteForm || {};
      const kind = document.getElementById('w-kind')?.value || 'ingredient';
      const photo = this.wasteForm.photo_image;
      if (!photo) return this.toast('Add a photo first', 'error');
      const payload = {
        damage_kind: kind,
        reason: document.getElementById('w-reason')?.value || 'Damaged',
        notes: document.getElementById('w-notes')?.value || '',
        quantity: parseFloat(document.getElementById('w-qty')?.value) || 0,
        unit: document.getElementById('w-unit')?.value || this.wasteForm?.unit || 'kg',
        photo_image: photo
      };
      if (kind === 'property') {
        payload.property_name = document.getElementById('w-prop')?.value?.trim();
        if (!payload.property_name) return this.toast('Describe the property', 'error');
        payload.quantity = payload.quantity > 0 ? payload.quantity : 1;
      } else {
        payload.product_id = parseInt(document.getElementById('w-prod')?.value || this.wasteForm?.product_id, 10);
        if (!payload.product_id || !(payload.quantity > 0)) return this.toast('Select product and quantity', 'error');
      }
      this._savingWaste = true;
      this.paintBody();
      try {
        const res = await ExpenseAPI.wasteRecord(payload);
        this.wasteForm = { kind: 'ingredient', quantity: '1' };
        this.updateSyncBadge();
        this.toast(res?.__offlineQueued ? 'No connection — waste saved offline and will sync when online' : 'Submitted for admin approval');
        await this.loadWaste(true);
        this.paintBody();
      } catch (err) {
        this.toast(err.message || 'Submit failed', 'error');
        this._savingWaste = false;
        this.paintBody();
      } finally {
        this._savingWaste = false;
      }
    });

    document.getElementById('sby-new')?.addEventListener('click', () => {
      this.sbyForm = this.defaultSbyForm();
      this.sbyView = 'create';
      this.paintBody();
    });
    document.getElementById('sby-refresh')?.addEventListener('click', async () => {
      await this.loadBatches(true);
      this.paintBody();
    });
    document.getElementById('sby-back')?.addEventListener('click', async () => {
      this.sbyView = 'list';
      this.sbyDetailId = null;
      this.sbyDetail = null;
      await this.loadBatches(true);
      this.paintBody();
    });
    document.getElementById('sby-back-detail')?.addEventListener('click', () => {
      this.sbyView = 'detail';
      this.paintBody();
    });
    document.querySelectorAll('.sby-row-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.sbyId);
        if (!id) return;
        this.sbyDetailId = id;
        this.sbyView = 'detail';
        this.paintBody();
        try {
          this.sbyDetail = await ExpenseAPI.stockBatchGet(id);
          this.sbyEvents = await ExpenseAPI.stockBatchEvents(id, 30).catch(() => []);
        } catch (err) {
          this.toast(err.message || 'Could not load batch', 'error');
          this.sbyView = 'list';
        }
        this.paintBody();
      });
    });
    document.getElementById('sby-stock-pick')?.addEventListener('click', async () => {
      if (!this.sbyProducts?.length) await this.loadBatches(true);
      this.openProductPicker({
        items: this.sbyProducts || [],
        title: 'Stock / ingredient purchased',
        onPick: async (row) => {
          this.sbyForm = this.sbyForm || this.defaultSbyForm();
          this.sbyForm.stock_product_id = row.id;
          this.sbyForm.stock_product_name = row.name;
          this.sbyForm.unit = row.unit || row.stock_unit || this.sbyForm.unit || 'kg';
          try {
            const meals = await ExpenseAPI.stockBatchMealsUsing(row.id);
            this.sbyForm.mealsUsing = Array.isArray(meals) ? meals : [];
            // Pre-check meals from recipes with recipe qty as default kg hint
            this.sbyForm.allocations = this.sbyForm.mealsUsing.map((m) => ({
              selling_product_id: m.id,
              selling_product_name: m.name,
              selling_price: m.selling_price,
              qty_kg: m.recipe_qty != null ? String(m.recipe_qty) : '',
              expected_portions: '',
              enabled: true
            }));
          } catch (_) {
            this.sbyForm.mealsUsing = [];
          }
          this.paintBody();
        }
      });
    });
    document.getElementById('sby-sell-pick')?.addEventListener('click', async () => {
      if (!this.sbyProducts?.length) await this.loadBatches(true);
      this.openProductPicker({
        items: this.sbyProducts || [],
        title: 'Selling product (POS item)',
        onPick: (row) => {
          this.sbyForm = this.sbyForm || this.defaultSbyForm();
          this.sbyForm.selling_product_id = row.id;
          this.sbyForm.selling_product_name = row.name;
          this.sbyForm.selling_price = row.selling_price != null ? String(row.selling_price) : this.sbyForm.selling_price;
          this.paintBody();
        }
      });
    });
    document.querySelectorAll('.sby-alloc-on').forEach((cb) => {
      cb.addEventListener('change', () => {
        this.syncSbyAllocFromDom();
        this.paintBody();
      });
    });
    const updatePreview = () => this.updateSbyPreview();
    document.getElementById('sby-cost')?.addEventListener('input', updatePreview);
    document.getElementById('sby-yield')?.addEventListener('input', updatePreview);
    document.getElementById('sby-save')?.addEventListener('click', async () => {
      if (this._savingBatch) return;
      this.syncSbyAllocFromDom();
      const stockName = document.getElementById('sby-stock-name')?.value?.trim();
      const cost = Number(document.getElementById('sby-cost')?.value);
      const allocs = (this.sbyForm?.allocations || []).filter((a) => a.enabled !== false && a.selling_product_id);
      const yieldN = Number(document.getElementById('sby-yield')?.value)
        || allocs.reduce((s, a) => s + (Number(a.expected_portions) || 0), 0)
        || 1;
      if (!stockName) return this.toast('Enter stock item name', 'error');
      if (!(cost >= 0) || Number.isNaN(cost)) return this.toast('Enter purchase cost', 'error');
      if (!(yieldN > 0) && !allocs.length) return this.toast('Enter expected yield or allocate meals', 'error');
      const first = allocs[0];
      this._savingBatch = true;
      this.paintBody();
      try {
        const created = await ExpenseAPI.stockBatchCreate({
          stock_product_name: stockName,
          stock_product_id: Number(document.getElementById('sby-stock-id')?.value) || null,
          selling_product_id: first?.selling_product_id || Number(this.sbyForm?.selling_product_id) || null,
          selling_product_name: first?.selling_product_name || this.sbyForm?.selling_product_name || null,
          purchase_cost: cost,
          expected_yield: yieldN,
          selling_price: Number(first?.selling_price) || Number(this.sbyForm?.selling_price) || 0,
          purchase_date: document.getElementById('sby-date')?.value || this.today(),
          supplier_name: document.getElementById('sby-supplier')?.value?.trim() || null,
          quantity_purchased: Number(document.getElementById('sby-qty')?.value) || 0,
          unit: document.getElementById('sby-unit')?.value?.trim() || 'kg',
          notes: document.getElementById('sby-notes')?.value?.trim() || null,
          allocations: allocs.map((a) => ({
            selling_product_id: a.selling_product_id,
            selling_product_name: a.selling_product_name,
            qty_kg: Number(a.qty_kg) || 0,
            expected_portions: Number(a.expected_portions) || 0,
            selling_price: Number(a.selling_price) || 0
          }))
        });
        this.updateSyncBadge();
        if (created?.__offlineQueued) {
          this.toast('No connection — batch saved offline and will sync when online');
          this.sbyForm = null;
          this.sbyView = 'list';
          this.paintBody();
          return;
        }
        this.toast(`Batch ${created?.batch_number || ''} saved`);
        this.sbyForm = null;
        this.sbyDetailId = created?.id || null;
        this.sbyDetail = created || null;
        this.sbyView = created?.id ? 'detail' : 'list';
        await this.loadBatches(true);
        this.paintBody();
      } catch (err) {
        this.toast(err.message || 'Could not save batch', 'error');
        this._savingBatch = false;
        this.paintBody();
      } finally {
        this._savingBatch = false;
      }
    });
    document.getElementById('sby-d-waste')?.addEventListener('click', () => {
      this.sbyWasteForm = { quantity: '1', reason: 'Damaged', notes: '' };
      this.sbyView = 'waste';
      this.paintBody();
    });
    document.getElementById('sby-d-actual')?.addEventListener('click', async () => {
      const b = this.sbyDetail;
      if (!b) return;
      const raw = window.prompt('Actual yield (portions produced)', String(b.actual_yield || b.expected_yield || ''));
      if (raw == null) return;
      const y = Number(raw);
      if (!(y > 0)) return this.toast('Enter a valid yield', 'error');
      try {
        this.sbyDetail = await ExpenseAPI.stockBatchSetActualYield(b.id, y);
        this.toast('Actual yield updated');
        await this.loadBatches(true);
        this.paintBody();
      } catch (err) {
        this.toast(err.message || 'Update failed', 'error');
      }
    });
    document.getElementById('sby-d-close')?.addEventListener('click', async () => {
      const b = this.sbyDetail;
      if (!b) return;
      if (!window.confirm(`Close batch ${b.batch_number}?`)) return;
      try {
        this.sbyDetail = await ExpenseAPI.stockBatchClose(b.id, 'Closed from phone');
        this.toast('Batch closed');
        await this.loadBatches(true);
        this.paintBody();
      } catch (err) {
        this.toast(err.message || 'Close failed', 'error');
      }
    });
    document.getElementById('sby-w-save')?.addEventListener('click', async () => {
      const b = this.sbyDetail;
      if (!b) return;
      const quantity = Number(document.getElementById('sby-w-qty')?.value);
      if (!(quantity > 0)) return this.toast('Enter waste quantity', 'error');
      try {
        this.sbyDetail = await ExpenseAPI.stockBatchWaste(b.id, {
          quantity,
          reason: document.getElementById('sby-w-reason')?.value || 'Damaged',
          notes: document.getElementById('sby-w-notes')?.value || ''
        });
        this.toast('Waste recorded');
        this.sbyView = 'detail';
        this.sbyEvents = await ExpenseAPI.stockBatchEvents(b.id, 30).catch(() => this.sbyEvents || []);
        await this.loadBatches(true);
        this.paintBody();
      } catch (err) {
        this.toast(err.message || 'Waste failed', 'error');
      }
    });

    document.querySelectorAll('.exp-item-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idRaw = btn.dataset.expId;
        if (btn.dataset.expPending === '1' || String(idRaw).startsWith('local-')) {
          this.historyDetail = this.expenses.find((x) => String(x.id) === String(idRaw)) || null;
          this.paintBody();
          return;
        }
        const id = Number(idRaw);
        const cached = this.expenses.find((x) => Number(x.id) === id) || null;
        try {
          this.historyDetail = await ExpenseAPI.get(id);
        } catch (_) {
          this.historyDetail = cached;
        }
        this.paintBody();
      });
    });
  },

  async handleInvoicePick(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    try {
      const dataUrl = await this.fileToDataUrl(file);
      this.form.invoicePreview = dataUrl;
      this.form.invoiceDataUrl = dataUrl;
      this.paintBody();
      this.toast('Invoice photo attached');
    } catch (err) {
      this.toast(err.message || 'Could not attach photo', 'error');
    }
  },

  async saveExpense() {
    if (this._saving) return;
    this.syncLineItemsFromDom();
    this.form.overheadName = document.getElementById('exp-overhead-name')?.value || this.form.overheadName || '';
    this.form.overheadAmount = document.getElementById('exp-overhead-amount')?.value || this.form.overheadAmount || '';
    let line_items = [];
    let amount = 0;
    let notes = (document.getElementById('exp-notes')?.value || this.form.notes || '').trim();
    if (this.form.entryMode === 'overhead') {
      amount = Math.round((parseFloat(this.form.overheadAmount) || 0) * 100) / 100;
      if (!(amount > 0)) return this.toast('Enter the bill amount', 'error');
      notes = String(this.form.overheadName || '').trim() || notes || this.form.category || 'Overhead';
      line_items = [];
    } else {
      line_items = this.validLineItems();
      if (!line_items.length) return this.toast('Add at least one item with a name and price', 'error');
      amount = this.calcTotal();
    }

    const category = this.form.category || 'other';
    const expense_date = document.getElementById('exp-date')?.value || this.today();

    this._saving = true;
    const btn = document.getElementById('exp-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const payment_method = document.getElementById('exp-payment')?.value || this.form.payment_method || 'cash';
      const funding_source = this.form.funding_source === 'owner' ? 'owner' : 'business';
      const cash_source = this.form.cash_source === 'previous' ? 'previous' : 'today';
      const saved = await ExpenseAPI.save({
        category,
        amount,
        expense_date,
        notes,
        description: notes,
        line_items,
        payment_method,
        funding_source,
        cash_source,
        invoice_image: this.form.invoiceDataUrl || null
      });
      this.updateSyncBadge();
      if (saved?.__offlineQueued) {
        this.addPendingExpense({
          category,
          amount,
          expense_date,
          description: notes,
          notes,
          line_items,
          payment_method,
          funding_source,
          cash_source,
          invoice_url: this.form.invoiceDataUrl || '',
          has_invoice: !!this.form.invoiceDataUrl
        });
        this.toast('Saved offline — will sync when online');
      } else {
        this.toast(funding_source === 'owner' ? 'Expense submitted — recorded as owner-funded' : 'Expense submitted');
      }
      this.resetForm();
      this.tab = 'history';
      document.querySelectorAll('#exp-nav [data-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === 'history');
      });
      await this.loadHistory(true);
      if (saved && !saved.__offlineQueued && saved.id) {
        const idx = this.expenses.findIndex((e) => Number(e.id) === Number(saved.id));
        const merged = {
          ...(idx >= 0 ? this.expenses[idx] : {}),
          ...saved,
          invoice_url: saved.invoice_url || this.invoiceSrc(saved) || (idx >= 0 ? this.expenses[idx].invoice_url : '')
        };
        if (idx >= 0) this.expenses[idx] = merged;
        else this.expenses.unshift(merged);
      }
      this.paintBody();
    } catch (err) {
      this.toast(err.message || 'Could not submit expense', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit expense'; }
    } finally {
      this._saving = false;
    }
  },

  async logout() {
    try { await ExpenseAPI.flushQueue(); } catch (_) { /* keep queued */ }
    const pending = await ExpenseAPI.pendingCount();
    // Queued items carry this user's session; keep it valid on the server until they sync.
    if (!pending) {
      try { await ExpenseAPI.logout(); } catch (_) { /* ignore */ }
    }
    this.lockToLogin(pending ? `Signed out — ${pending} offline item(s) will sync when online` : '');
  }
};

function bootExpenseApp() {
  if (window.__expenseAppBooted) return;
  window.__expenseAppBooted = true;
  try {
    ExpenseApp.init();
  } catch (err) {
    console.error('[ExpenseApp] init failed', err);
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `<div class="login-wrap"><div class="login-card"><h1>Expenses</h1><p class="error-msg">Could not start the app. Refresh the page or reinstall the APK.</p><p class="muted">${String(err.message || err).slice(0, 120)}</p></div></div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootExpenseApp);
} else {
  bootExpenseApp();
}

window.ExpenseApp = ExpenseApp;
