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
    lineItems: [{ _id: 1, name: '', qty: '1', price: '' }],
    invoicePreview: '',
    invoiceDataUrl: ''
  },
  _saving: false,
  _loadingHistory: false,
  _historyError: '',
  historyDetail: null,
  _pendingKey: 'expense_pending_local',

  init() {
    try {
      this.user = JSON.parse(localStorage.getItem('expense_user') || 'null');
    } catch (_) { this.user = null; }
    this.form.expense_date = this.today();
    this.bindNav();
    this.bindLineItemActions();
    if (this.token && this.user) {
      this.view = 'main';
      this.bootstrap();
    } else {
      this.render();
    }
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

  parsePrice(v) {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  },

  validLineItems() {
    return (this.form.lineItems || [])
      .map((row) => {
        const name = String(row.name || '').trim();
        const quantity = Math.max(this.parsePrice(row.qty) || 1, 0.001);
        const unit_price = this.parsePrice(row.price);
        const amount = Math.round(quantity * unit_price * 100) / 100;
        return { name, quantity, unit_price, amount };
      })
      .filter((row) => row.name && row.unit_price > 0 && row.amount > 0);
  },

  calcTotal() {
    return Math.round(this.validLineItems().reduce((s, row) => s + (Number(row.amount) || 0), 0) * 100) / 100;
  },

  addLineItem() {
    this.form.lineItems.push({ _id: this._lineSeq++, name: '', qty: '1', price: '' });
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
      const btn = e.target.closest('.line-item-remove');
      if (!btn || btn.dataset.removeId == null) return;
      e.preventDefault();
      e.stopPropagation();
      this.syncLineItemsFromDom();
      this.removeLineItem(btn.dataset.removeId);
    });
  },

  applyBranding() {
    const logo = this.settings?.logo_path;
    const shop = this.settings?.shop_name || 'Expenses';
    document.title = `${shop} — Expenses`;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = logo ? (String(logo).startsWith('http') ? logo : '/api/logo') : '/api/logo';
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
      lineItems: [{ _id: 1, name: '', qty: '1', price: '' }],
      invoicePreview: '',
      invoiceDataUrl: ''
    };
  },

  async fileToDataUrl(file, maxW = 1400, quality = 0.82) {
    if (!file) return null;
    if (!/^image\//.test(file.type || '')) throw new Error('Please choose a photo (JPEG or PNG).');
    if (file.size > 12 * 1024 * 1024) throw new Error('Photo is too large. Use a photo under 12 MB.');
    const blobUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not read photo'));
        el.src = blobUrl;
      });
      const scale = img.width > maxW ? maxW / img.width : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  },

  clearInvoice() {
    this.form.invoicePreview = '';
    this.form.invoiceDataUrl = '';
    this.paintBody();
  },

  bindNav() {
    if (this._navBound) return;
    this._navBound = true;
    document.getElementById('exp-nav')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.tab = btn.dataset.tab;
      this.historyDetail = null;
      document.querySelectorAll('#exp-nav [data-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === this.tab);
      });
      if (this.tab === 'history') await this.loadHistory(true);
      this.paintBody();
    });
    window.addEventListener('portal-offline-flushed', () => {
      if (this.tab === 'history' && this.view === 'main') {
        this.loadHistory(true).then(() => this.paintBody()).catch(() => {});
      }
    });
  },

  getPendingExpenses() {
    try {
      return JSON.parse(localStorage.getItem(this._pendingKey) || '[]');
    } catch (_) {
      return [];
    }
  },

  addPendingExpense(record) {
    const list = this.getPendingExpenses();
    list.unshift({
      ...record,
      id: `local-${Date.now()}`,
      pending: true,
      user_name: this.user?.full_name || this.user?.username || 'You'
    });
    localStorage.setItem(this._pendingKey, JSON.stringify(list.slice(0, 40)));
  },

  prunePendingExpenses(serverRows) {
    const pending = this.getPendingExpenses();
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
      else hdr.textContent = this.tab === 'new' ? 'New expense' : this.tab === 'history' ? 'Recent expenses' : 'Your profile';
    }
    if (body) {
      body.innerHTML = this.renderBody();
      this.bindMain();
    }
  },

  async bootstrap() {
    document.getElementById('exp-nav')?.classList.remove('hidden');
    try {
      const [settings, categories, profile] = await Promise.all([
        ExpenseAPI.settings().catch(() => this.settings),
        ExpenseAPI.categories().catch(() => ['other']),
        ExpenseAPI.profile().catch(() => this.user)
      ]);
      this.settings = settings || this.settings;
      this.categories = categories?.length ? categories : ['other'];
      this.user = profile || this.user;
      this.applyBranding();
      localStorage.setItem('expense_user', JSON.stringify(this.user));
      if (this.tab === 'history') await this.loadHistory();
    } catch (err) {
      this.token = '';
      this.user = null;
      localStorage.removeItem('expense_token');
      localStorage.removeItem('expense_user');
      this.view = 'login';
      document.getElementById('exp-nav')?.classList.add('hidden');
      this.toast(err.message || 'Session expired', 'error');
    }
    this.render();
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
    else app?.classList.add('hidden');
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = this.view === 'login' ? this.renderLogin() : this.renderShell();
    if (this.view === 'login') this.bindLogin();
    else this.bindMain();
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
      this.token = res.token;
      this.user = res.user;
      localStorage.setItem('expense_token', res.token);
      localStorage.setItem('expense_user', JSON.stringify(res.user));
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
    return `
      <header class="hdr">
        <div class="hdr-title">
          <h2>${this.tab === 'new' ? 'New expense' : this.tab === 'history' ? 'Recent expenses' : 'Your profile'}</h2>
          <p>${this.esc(this.settings.shop_name || 'Shop POS')}</p>
        </div>
        ${this.settings.logo_path ? `<div class="shop-badge"><img src="${this.esc(this.settings.logo_path)}" alt="" onerror="this.style.display='none'"><span>${this.esc(this.settings.shop_name)}</span></div>` : ''}
      </header>
      <div id="exp-body">${this.renderBody()}</div>`;
  },

  renderBody() {
    if (this.tab === 'history' && this.historyDetail) return this.renderDetail(this.historyDetail);
    if (this.tab === 'history') return this.renderHistory();
    if (this.tab === 'profile') return this.renderProfile();
    return this.renderForm();
  },

  renderLineItems() {
    return (this.form.lineItems || []).map((row, idx) => `
      <div class="line-item-row" data-id="${row._id}">
        <div class="line-item-num">${idx + 1}</div>
        <div class="line-item-fields">
          <input type="text" class="line-item-name" placeholder="Item name" value="${this.esc(row.name)}" autocomplete="off">
          <input type="number" class="line-item-qty" placeholder="Qty" inputmode="decimal" step="any" min="0.001" value="${this.esc(row.qty != null ? row.qty : '1')}">
          <input type="number" class="line-item-price" placeholder="Price" inputmode="decimal" step="0.01" min="0" value="${this.esc(row.price)}">
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
      <div class="form-card line-items-card">
        <div class="line-items-head">
          <p class="section-label" style="margin:0">Invoice line items</p>
          <span class="muted" id="exp-line-count">${validCount ? `${validCount} item${validCount === 1 ? '' : 's'}` : 'Add items below'}</span>
        </div>
        <p class="muted line-items-hint">Enter item name, quantity, and unit price. Line total = qty × price.</p>
        <div class="line-items-columns"><span>Item</span><span>Qty</span><span>Price</span></div>
        <div id="exp-line-list">${this.renderLineItems()}</div>
        <button type="button" class="btn btn-add-line" id="exp-add-line">+ Add another item</button>
      </div>

      <div class="amount-hero amount-hero-total">
        <label>Invoice total</label>
        <div class="amount-total-display" id="exp-total-display">${this.fmt(total)}</div>
        <p class="muted amount-total-note">Calculated from your line items</p>
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
      const qty = Number(r.quantity) > 1 ? `${r.quantity}× ` : '';
      return `<li><span>${this.esc(r.name)} <small>${qty}${this.fmt(r.unit_price || r.amount)}</small></span><strong>${this.fmt(r.amount)}</strong></li>`;
    }).join('')}</ul>`;
  },

  renderDetail(e) {
    const items = e.line_items || [];
    const lines = items.length ? items.map((r) => `
      <div class="detail-line">
        <div><strong>${this.esc(r.name)}</strong><br><span class="muted">${Number(r.quantity) || 1} × ${this.fmt(r.unit_price)}</span></div>
        <strong>${this.fmt(r.amount)}</strong>
      </div>`).join('') : `<p class="muted">${this.esc(e.description || 'No line items')}</p>`;

    return `
      <button type="button" class="btn btn-ghost" id="exp-detail-back" style="width:auto;margin-bottom:12px">← Back to list</button>
      <div class="form-card">
        <p class="muted" style="margin:0 0 4px">${this.esc(e.expense_date || '')} · ${this.catLabel(e.category)}</p>
        <h3 style="margin:0 0 8px">${this.fmt(Number(e.amount) || 0)}</h3>
        ${e.description ? `<p class="muted" style="margin:0">${this.esc(e.description)}</p>` : ''}
        <p class="muted" style="margin:8px 0 0;font-size:0.85rem">By ${this.esc(e.user_name || '—')}</p>
      </div>
      <div class="form-card">
        <p class="section-label" style="margin-top:0">Line items</p>
        ${lines}
        <div class="detail-line detail-total"><span>Total</span><strong>${this.fmt(Number(e.amount) || items.reduce((s, r) => s + (Number(r.amount) || 0), 0))}</strong></div>
      </div>
      ${e.invoice_url ? `
      <div class="form-card invoice-card">
        <p class="section-label" style="margin-top:0">Invoice photo</p>
        <a href="${this.esc(e.invoice_url)}" target="_blank" rel="noopener">
          <img src="${this.esc(e.invoice_url)}" alt="Invoice" class="invoice-preview">
        </a>
      </div>` : '<p class="muted" style="text-align:center">No invoice photo</p>'}`;
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
        ${e.invoice_url
          ? `<span class="exp-item-thumb"><img src="${this.esc(e.invoice_url)}" alt="Invoice"></span>`
          : `<span class="exp-item-icon">${this.catIcon(e.category)}</span>`}
        <span class="exp-item-body">
          <span class="exp-item-top">
            <strong>${this.esc(title)}</strong>
            <span class="exp-amount">${this.fmt(Number(e.amount) || 0)}</span>
          </span>
          ${this.renderLineItemsSummary(e.line_items)}
          <span class="exp-meta">${this.esc(e.expense_date || '')}${e.user_name ? ` · ${this.esc(e.user_name)}` : ''}${e.branch_name ? ` · ${this.esc(e.branch_name)}` : ''}</span>
          <span class="tag">${this.catLabel(e.category)}</span>${pending}
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
      <button type="button" class="btn btn-danger" id="exp-logout-btn">Sign out</button>`;
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
        this.token = res.token;
        this.user = res.user;
        localStorage.setItem('expense_token', res.token);
        localStorage.setItem('expense_user', JSON.stringify(res.user));
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

    document.getElementById('exp-date')?.addEventListener('change', (e) => {
      this.form.expense_date = e.target.value;
    });
    document.getElementById('exp-notes')?.addEventListener('input', (e) => {
      this.form.notes = e.target.value;
    });

    document.getElementById('exp-line-list')?.addEventListener('input', () => this.updateTotalDisplay());
    document.getElementById('exp-add-line')?.addEventListener('click', () => this.addLineItem());

    document.getElementById('exp-invoice-camera')?.addEventListener('change', (e) => this.handleInvoicePick(e.target));
    document.getElementById('exp-invoice-file')?.addEventListener('change', (e) => this.handleInvoicePick(e.target));
    document.getElementById('exp-invoice-clear')?.addEventListener('click', () => this.clearInvoice());

    document.getElementById('exp-save-btn')?.addEventListener('click', () => this.saveExpense());
    document.getElementById('exp-logout-btn')?.addEventListener('click', () => this.logout());

    document.getElementById('exp-detail-back')?.addEventListener('click', () => {
      this.historyDetail = null;
      this.paintBody();
    });

    document.getElementById('exp-history-refresh')?.addEventListener('click', async () => {
      await this.loadHistory(true);
      this.paintBody();
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
    const line_items = this.validLineItems();
    if (!line_items.length) return this.toast('Add at least one item with a name and price', 'error');

    const category = this.form.category || 'other';
    const expense_date = document.getElementById('exp-date')?.value || this.today();
    const notes = (document.getElementById('exp-notes')?.value || this.form.notes || '').trim();
    const amount = this.calcTotal();

    this._saving = true;
    const btn = document.getElementById('exp-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const saved = await ExpenseAPI.save({
        category,
        amount,
        expense_date,
        notes,
        description: notes,
        line_items,
        invoice_image: this.form.invoiceDataUrl || null
      });
      if (saved?.__offlineQueued) {
        this.addPendingExpense({
          category,
          amount,
          expense_date,
          description: notes,
          notes,
          line_items
        });
        this.toast('Saved offline — will sync when online');
      } else {
        this.toast('Expense submitted');
      }
      this.resetForm();
      this.tab = 'history';
      document.querySelectorAll('#exp-nav [data-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === 'history');
      });
      await this.loadHistory(true);
      this.paintBody();
    } catch (err) {
      this.toast(err.message || 'Could not submit expense', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit expense'; }
    } finally {
      this._saving = false;
    }
  },

  async logout() {
    try { await ExpenseAPI.logout(); } catch (_) { /* ignore */ }
    this.token = '';
    this.user = null;
    localStorage.removeItem('expense_token');
    localStorage.removeItem('expense_user');
    this.view = 'login';
    this.render();
  }
};

document.addEventListener('DOMContentLoaded', () => ExpenseApp.init());

window.ExpenseApp = ExpenseApp;
