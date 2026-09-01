/**
 * Standalone Recipe & Production Management System
 * Own login, shell, roles — syncs with POS inventory via shared SQLite.
 */
const RecipePerms = {
  matrix: {
    administrator: { view: 1, create: 1, edit: 1, delete: 1, approve: 1, produce: 1, costing: 1, prices: 1, users: 1, settings: 1, reports: 1, waste_approve: 1, promotions: 1 },
    production_manager: { view: 1, create: 1, edit: 1, produce: 1, costing: 1, request_price: 1, reports: 1 },
    kitchen_manager: { view: 1, produce: 1, reports: 1 },
    supervisor: { view: 1, produce: 1, reports: 1 },
    viewer: { view: 1, reports: 1 }
  },
  can(user, perm) {
    if (!user) return false;
    if (user.role === 'owner' || user.recipe_role === 'administrator') return true;
    return !!(this.matrix[user.recipe_role] || {})[perm];
  }
};

const RecipeProductionApp = {
  user: null,
  page: 'dashboard',
  pageHistory: [],
  settings: null,
  _ingredients: [],
  _editingRecipe: null,
  _open: false,
  branchId: null,
  branches: [],

  branchFilter() {
    if (this.branchId == null || this.branchId === '' || this.branchId === 'all') return {};
    return { branch_id: Number(this.branchId) };
  },

  async bindBranchSelect(root) {
    const sel = root?.querySelector?.('#rp-branch-select') || document.getElementById('rp-branch-select');
    if (!sel) return;
    try {
      const r = await API.getBranches?.();
      this.branches = r?.success ? (r.data || []) : [];
    } catch (_) {
      this.branches = [];
    }
    const isOwner = this.user?.role === 'owner' || this.user?.recipe_role === 'administrator';
    const forced = this.user?.branch_id != null ? Number(this.user.branch_id) : null;
    if (!isOwner && forced) {
      this.branchId = forced;
      sel.innerHTML = (this.branches.filter((b) => Number(b.id) === forced).map((b) =>
        `<option value="${b.id}">${Utils.escHtml(b.name)}</option>`).join(''))
        || `<option value="${forced}">Branch ${forced}</option>`;
      sel.value = String(forced);
      sel.disabled = true;
      return;
    }
    sel.innerHTML = `<option value="all">All branches</option>`
      + this.branches.map((b) => `<option value="${b.id}">${Utils.escHtml(b.name)}</option>`).join('');
    if (this.branchId != null) sel.value = String(this.branchId);
    else sel.value = 'all';
    sel.onchange = () => {
      this.branchId = sel.value === 'all' ? null : Number(sel.value);
      this.renderPage();
    };
  },

  isOpen() {
    return !!this._open;
  },

  /** Return true if handled (stayed inside Recipe). False = exit Recipe to POS/Admin. */
  goBackInApp() {
    if (this.pageHistory.length) {
      this.page = this.pageHistory.pop();
      const root = document.getElementById('recipe-production-root');
      if (root) {
        root.querySelectorAll('.rp-nav-btn[data-page]').forEach(x =>
          x.classList.toggle('active', x.dataset.page === this.page));
        this.renderPage();
      }
      return true;
    }
    return false;
  },

  money(n) {
    const c = this.settings?.currency || 'R';
    return Utils.formatMoney(Number(n) || 0, c);
  },

  exportCsv(filename, rows) {
    if (!rows?.length) return Utils.toast('No data to export', 'error');
    const keys = Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'recipe-report.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    Utils.toast('CSV downloaded', 'success');
  },

  companyInfo() {
    return {
      name: this.settings?.app_display_name || this.settings?.shop_name || 'Shop POS',
      phone: this.settings?.phone || '',
      address: this.settings?.address || '',
      currency: this.settings?.currency || 'R'
    };
  },

  /** A4 PDF download for table-style documents */
  async exportPdf(filename, title, headers, rows) {
    if (!headers?.length || !rows?.length) return Utils.toast('No data to export as PDF', 'error');
    if (typeof Export?.toPDF !== 'function') {
      return this.printHtml(title, headers, rows);
    }
    return Export.toPDF(filename || `recipe-${Date.now()}.pdf`, title, headers, rows, this.companyInfo());
  },

  /** A4 print preview for table-style documents */
  async printDoc(title, headers, rows) {
    if (!headers?.length || !rows?.length) return Utils.toast('No data to print', 'error');
    if (typeof Export?.print === 'function') {
      return Export.print(title, headers, rows, this.companyInfo());
    }
    return this.printHtml(title, headers, rows);
  },

  printHtml(title, headers, rows) {
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const company = this.companyInfo();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        body{font-family:Segoe UI,Arial,sans-serif;color:#0f172a;font-size:12px}
        h1{font-size:18px;margin:0 0 4px}
        .meta{color:#64748b;margin-bottom:14px}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#f1f5f9}
        @media print{button{display:none}}
      </style></head><body>
      <h1>${esc(title)}</h1>
      <div class="meta">${esc(company.name)}${company.phone ? ' · ' + esc(company.phone) : ''}<br>${esc(new Date().toLocaleString())}</div>
      <table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
      </body></html>`;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!w) return Utils.toast('Allow pop-ups to print', 'error');
    w.document.write(html);
    w.document.close();
    Utils.toast('Print preview opened (A4)', 'success');
  },

  rowsToMatrix(rows, keys) {
    const ks = keys || (rows?.[0] ? Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object') : []);
    return {
      headers: ks,
      matrix: (rows || []).map(r => ks.map(k => r[k] ?? '')),
      keys: ks
    };
  },

  docActionsHtml(prefix = 'rp-doc') {
    return `
      <button type="button" class="btn btn-ghost btn-sm" id="${prefix}-pdf">Download PDF</button>
      <button type="button" class="btn btn-ghost btn-sm" id="${prefix}-print">Print A4</button>`;
  },

  bindDocActions(prefix, getPayload) {
    document.getElementById(`${prefix}-pdf`)?.addEventListener('click', async () => {
      const p = typeof getPayload === 'function' ? getPayload() : getPayload;
      if (!p?.rows?.length) return Utils.toast('No data to export', 'error');
      const { headers, matrix } = Array.isArray(p.rows[0])
        ? { headers: p.headers, matrix: p.rows }
        : this.rowsToMatrix(p.rows, p.keys);
      await this.exportPdf(p.filename || `recipe-${Date.now()}.pdf`, p.title || 'Recipe Report', headers, matrix);
    });
    document.getElementById(`${prefix}-print`)?.addEventListener('click', async () => {
      const p = typeof getPayload === 'function' ? getPayload() : getPayload;
      if (!p?.rows?.length) return Utils.toast('No data to print', 'error');
      const { headers, matrix } = Array.isArray(p.rows[0])
        ? { headers: p.headers, matrix: p.rows }
        : this.rowsToMatrix(p.rows, p.keys);
      await this.printDoc(p.title || 'Recipe Report', headers, matrix);
    });
  },

  recentIngredientIds() {
    try {
      const raw = localStorage.getItem('shoppos_rp_recent_ings');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(Number).filter(Boolean).slice(0, 12) : [];
    } catch { return []; }
  },

  pushRecentIngredient(id) {
    if (!id) return;
    const next = [Number(id), ...this.recentIngredientIds().filter(x => x !== Number(id))].slice(0, 12);
    try { localStorage.setItem('shoppos_rp_recent_ings', JSON.stringify(next)); } catch (_) { /* ignore */ }
  },

  barChart(items, valueKey, labelKey) {
    const list = (items || []).slice(0, 8);
    if (!list.length) return '<p class="rp-muted">No chart data</p>';
    const max = Math.max(...list.map(i => Number(i[valueKey]) || 0), 1);
    return `<div class="rp-chart">${list.map(i => {
      const v = Number(i[valueKey]) || 0;
      const pct = Math.round((v / max) * 100);
      return `<div class="rp-chart-row"><span class="rp-chart-label">${i[labelKey] || '—'}</span>
        <div class="rp-chart-bar-wrap"><div class="rp-chart-bar" style="width:${pct}%"></div></div>
        <span class="rp-chart-val">${v}</span></div>`;
    }).join('')}</div>`;
  },

  statusTag(s) {
    const map = { draft: '', pending: 'warn', approved: 'ok', rejected: 'danger', archived: '' };
    return `<span class="rp-tag ${map[s] || ''}">${s || '—'}</span>`;
  },

  async open(app, opts = {}) {
    this.hostApp = app;
    this.settings = app?.settings || null;
    this.fromApp = !!opts.fromApp;
    this.user = null;
    this.page = 'dashboard';
    this.pageHistory = [];
    this._open = true;
    const root = document.getElementById('recipe-production-root');
    if (root) root.innerHTML = '<div class="rp-login-wrap"><p class="rp-muted" style="padding:24px;text-align:center">Opening Recipe &amp; Production…</p></div>';
    try {
      if (opts.fromApp && opts.posUser) {
        const r = await API.recipeSessionFromPos(opts.posUser);
        if (r.success && r.data) {
          this.user = r.data;
          this.render();
          return;
        }
        Utils.toast(r.error || 'No Recipe access for this user — sign in below', 'error');
      }
    } catch (err) {
      console.error('[RecipeProductionApp.open]', err);
      Utils.toast(err.message || 'Could not open Recipe system', 'error');
    }
    this.render();
  },

  close() {
    this.user = null;
    this._open = false;
    this.pageHistory = [];
    App.closeRecipeProduction();
  },

  render() {
    const root = document.getElementById('recipe-production-root');
    if (!root) return;
    if (!this.user) return this.renderLogin(root);
    return this.renderShell(root);
  },

  renderLogin(root) {
    const shop = this.settings?.app_display_name || this.settings?.shop_name || 'Shop POS';
    root.innerHTML = `<div class="rp-login-wrap">
      <div class="rp-login-card">
        <h1>Recipe & Production</h1>
        <p class="rp-muted" style="margin:0 0 18px">Owner / Admin: sign in with your POS username and password.<br>Staff need Recipe access granted by Admin. · ${shop}</p>
        <div class="field"><label>Username</label><input id="rp-user" autocomplete="username" autofocus></div>
        <div class="field"><label>Password</label><input type="password" id="rp-pass" autocomplete="current-password"></div>
          <div class="field"><label>PIN <span class="rp-muted">(optional)</span></label><input type="password" id="rp-pin" maxlength="12" inputmode="numeric"></div>
        <p id="rp-login-err" class="error-msg hidden"></p>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="rp-login-btn" style="margin-top:8px">Sign In to Recipe System</button>
        <button type="button" class="btn btn-ghost btn-block" id="rp-back" style="margin-top:10px">${this.fromApp ? '← Back to Admin / POS' : '← Back to POS Login'}</button>
      </div>
    </div>`;
    document.getElementById('rp-back').onclick = () => this.close();
    document.getElementById('rp-login-btn').onclick = () => this.doLogin();
    document.getElementById('rp-pass').onkeydown = (e) => { if (e.key === 'Enter') this.doLogin(); };
  },

  async doLogin() {
    const username = document.getElementById('rp-user')?.value.trim();
    const password = document.getElementById('rp-pass')?.value || '';
    const pin = document.getElementById('rp-pin')?.value || '';
    const err = document.getElementById('rp-login-err');
    if (!username || !password) {
      err.textContent = 'Username and password required';
      err.classList.remove('hidden');
      return;
    }
    const r = await API.recipeLogin(username, password, pin || null);
    if (!r.success) {
      err.textContent = r.error || 'Login failed';
      err.classList.remove('hidden');
      return;
    }
    this.user = r.data;
    this.render();
  },

  navItems() {
    const all = [
      ['dashboard', 'Dashboard', 'view'],
      ['categories', 'Categories', 'view'],
      ['products', 'Products', 'view'],
      ['prep', 'Prep Board', 'view'],
      ['ingredients', 'Ingredients', 'view'],
      ['recipes', 'Recipe Builder', 'view'],
      ['restock', 'Restock Ingredients', 'produce'],
      ['purchase-orders', 'Purchase Orders', 'produce'],
      ['approvals', 'Approvals', 'approve'],
      ['production', 'Production', 'produce'],
      ['waste', 'Waste', 'produce'],
      ['profits', 'Profits & Losses', 'reports'],
      ['daily-item-profits', 'Daily Item Profits', 'reports'],
      ['promotions', 'Promotions', 'promotions'],
      ['reports', 'Reports', 'reports'],
      ['users', 'Users & Access', 'users'],
      ['settings', 'Settings', 'settings']
    ];
    return all.filter(([, , perm]) => {
      if (perm === 'view' || perm === 'reports') return RecipePerms.can(this.user, 'view');
      if (perm === 'approve') return RecipePerms.can(this.user, 'approve') || RecipePerms.can(this.user, 'view');
      if (perm === 'produce') return RecipePerms.can(this.user, 'produce') || RecipePerms.can(this.user, 'view');
      if (perm === 'promotions') return RecipePerms.can(this.user, 'promotions') || RecipePerms.can(this.user, 'view');
      return RecipePerms.can(this.user, perm);
    });
  },

  renderShell(root) {
    const nav = this.navItems().map(([id, label]) =>
      `<button type="button" class="rp-nav-btn ${this.page === id ? 'active' : ''}" data-page="${id}">${label}</button>`
    ).join('');
    root.innerHTML = `<div class="rp-shell">
      <div class="rp-sidebar-backdrop" id="rp-sidebar-backdrop" aria-hidden="true"></div>
      <aside class="rp-sidebar" id="rp-sidebar">
        <div class="rp-brand">Recipe & Production<small>${this.user.recipe_role || 'user'} · ${this.user.full_name || this.user.username}</small></div>
        ${nav}
        <div style="flex:1"></div>
        <button type="button" class="rp-nav-btn" id="rp-exit">${this.fromApp ? '← Back to Admin / POS' : 'Exit to POS Login'}</button>
      </aside>
      <main class="rp-main">
        <div class="rp-topbar">
          <button type="button" class="btn-icon rp-menu-toggle" id="rp-menu-toggle" aria-label="Open menu">☰</button>
          <h2 id="rp-page-title">Dashboard</h2>
          <div class="rp-branch-bar" style="display:flex;align-items:center;gap:8px;margin-left:auto;margin-right:12px">
            <label class="muted" style="font-size:12px;white-space:nowrap">Branch</label>
            <select id="rp-branch-select" style="min-width:140px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);font-size:13px">
              <option value="all">All branches</option>
            </select>
          </div>
          <div class="rp-user-chip">
            <span>${this.user.full_name || this.user.username}</span>
            <button type="button" class="btn btn-ghost btn-sm" id="rp-logout">Logout</button>
          </div>
        </div>
        <div id="rp-content"></div>
      </main>
    </div>`;
    const closeRpMenu = () => {
      root.querySelector('.rp-shell')?.classList.remove('rp-nav-open');
    };
    const openRpMenu = () => {
      root.querySelector('.rp-shell')?.classList.add('rp-nav-open');
    };
    document.getElementById('rp-menu-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const shell = root.querySelector('.rp-shell');
      if (shell?.classList.contains('rp-nav-open')) closeRpMenu();
      else openRpMenu();
    });
    document.getElementById('rp-sidebar-backdrop')?.addEventListener('click', closeRpMenu);
    this.bindBranchSelect(root);
    root.querySelectorAll('.rp-nav-btn[data-page]').forEach(b => b.addEventListener('click', () => {
      if (this.page && this.page !== b.dataset.page) {
        this.pageHistory.push(this.page);
        if (this.pageHistory.length > 30) this.pageHistory.shift();
      }
      this.page = b.dataset.page;
      if (this.page === 'restock' || this.page === 'ingredients') this._ingredients = [];
      // Fast nav: update active state + content only (avoid full shell rebuild)
      root.querySelectorAll('.rp-nav-btn[data-page]').forEach(x =>
        x.classList.toggle('active', x.dataset.page === this.page));
      closeRpMenu();
      this.renderPage();
    }));
    // In-app back (does not leave Recipe/POS without logout)
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn-icon';
    backBtn.id = 'rp-nav-back';
    backBtn.setAttribute('aria-label', 'Go back');
    backBtn.title = 'Back';
    backBtn.textContent = '←';
    const topbar = root.querySelector('.rp-topbar');
    const menuToggle = document.getElementById('rp-menu-toggle');
    if (topbar && menuToggle) topbar.insertBefore(backBtn, menuToggle);
    backBtn.addEventListener('click', () => {
      if (!this.goBackInApp()) this.close();
    });
    document.getElementById('rp-exit').onclick = () => this.close();
    document.getElementById('rp-logout').onclick = async () => {
      if (this.fromApp && typeof App?.closeRecipeProduction === 'function') {
        this.close();
        return;
      }
      try { await API.logout(); } catch (_) {}
      this.user = null;
      this.render();
    };
    this.renderPage();
  },

  async renderPage() {
    const el = document.getElementById('rp-content');
    const title = document.getElementById('rp-page-title');
    if (!el) return;
    const titles = {
      dashboard: 'Dashboard', categories: 'Categories', products: 'Products',
      prep: 'Daily Prep Board', ingredients: 'Ingredient Master', recipes: 'Recipe Builder',
      restock: 'Restock Ingredients', 'purchase-orders': 'Recipe Purchase Orders',
      approvals: 'Recipe Approvals', production: 'Production Planning', waste: 'Waste Management',
      profits: 'Profits & Losses',
      'daily-item-profits': 'Daily Item Profits',
      promotions: 'Promotions', reports: 'Reports', users: 'Users & Access', settings: 'Settings'
    };
    if (title) title.textContent = titles[this.page] || 'Recipe System';
    el.innerHTML = '<p class="rp-muted">Loading…</p>';
    try {
      const map = {
        dashboard: () => this.pageDashboard(el),
        categories: () => this.pageCategories(el),
        products: () => this.pageProducts(el),
        prep: () => this.pagePrepBoard(el),
        ingredients: () => this.pageIngredients(el),
        recipes: () => this.pageRecipes(el),
        restock: () => this.pageRestock(el),
        'purchase-orders': () => this.pagePurchaseOrders(el),
        approvals: () => this.pageApprovals(el),
        production: () => this.pageProduction(el),
        waste: () => this.pageWaste(el),
        profits: () => this.pageProfits(el),
        'daily-item-profits': () => this.pageDailyItemProfits(el),
        promotions: () => this.pagePromotions(el),
        reports: () => this.pageReports(el),
        users: () => this.pageUsers(el),
        settings: () => this.pageSettings(el)
      };
      await (map[this.page] || map.dashboard)();
    } catch (err) {
      el.innerHTML = `<p class="error-msg">${err.message || 'Failed to load'}</p>`;
    }
  },

  async ensurePosCatalogPages() {
    if (typeof App?.ensurePageScripts === 'function') {
      await App.ensurePageScripts('categories');
      await App.ensurePageScripts('products');
    }
    if (!window.CategoriesPage?.render && typeof Utils?.loadScript === 'function') {
      try { await Utils.loadScript('js/pages/categories.js'); } catch (_) { /* ignore */ }
    }
    if (!window.ProductsPage?.render && typeof Utils?.loadScript === 'function') {
      try { await Utils.loadScript('js/pages/products.js'); } catch (_) { /* ignore */ }
    }
  },

  async pageCategories(el) {
    await this.ensurePosCatalogPages();
    if (!window.CategoriesPage?.render) {
      el.innerHTML = '<p class="error-msg">Categories page failed to load. Open Categories from the main menu once, then return here.</p>';
      return;
    }
    el.innerHTML = '<div class="rp-embed-pos" id="rp-categories-host"></div>';
    const host = document.getElementById('rp-categories-host');
    const appCtx = window.App || { user: this.user, settings: window.App?.settings || {} };
    if (!appCtx.user) appCtx.user = this.user;
    await CategoriesPage.render(host, appCtx);
  },

  async pageProducts(el) {
    await this.ensurePosCatalogPages();
    if (!window.ProductsPage?.render) {
      el.innerHTML = '<p class="error-msg">Products page failed to load. Open Products from the main menu once, then return here.</p>';
      return;
    }
    el.innerHTML = '<div class="rp-embed-pos" id="rp-products-host"></div>';
    const host = document.getElementById('rp-products-host');
    const appCtx = window.App || { user: this.user, settings: window.App?.settings || {} };
    if (!appCtx.user) appCtx.user = this.user;
    await ProductsPage.render(host, appCtx);
  },

  /* ── Dashboard ─────────────────────────────────────────────────────────── */
  async pageDashboard(el) {
    const [dashRes, aiRes] = await Promise.all([
      API.recipeDashboard(this.user),
      API.recipeAi(this.user)
    ]);
    if (!dashRes.success) throw new Error(dashRes.error || 'Dashboard failed');
    const d = dashRes.data || {};
    const ai = aiRes.data || [];
    const prod = d.production || {};
    const meals = prod.products || [];
    const restock = prod.restock_recommendations || [];
    el.innerHTML = `
      <div class="rp-cards">
        <div class="rp-card"><div class="label">Total Meals Available</div><div class="value">${prod.total_meals_available ?? 0}</div></div>
        <div class="rp-card"><div class="label">Meals Sold Today</div><div class="value">${d.sold_today?.qty || 0}</div></div>
        <div class="rp-card"><div class="label">Meals Almost Out</div><div class="value">${(prod.meals_almost_out || []).length}</div></div>
        <div class="rp-card"><div class="label">Meals Disabled (OOS)</div><div class="value">${(prod.products_disabled || []).length}</div></div>
        <div class="rp-card"><div class="label">Ingredients Low</div><div class="value">${(prod.ingredients_running_low || []).length}</div></div>
        <div class="rp-card"><div class="label">Ingredients Out</div><div class="value">${(prod.ingredients_out_of_stock || []).length}</div></div>
        <div class="rp-card"><div class="label">Today's Waste</div><div class="value">${this.money(d.waste_today?.cost)}</div></div>
        <div class="rp-card"><div class="label">Active Promotions</div><div class="value">${d.active_promotions || 0}</div></div>
      </div>
      <div class="rp-toolbar">
        <button class="btn btn-primary" id="rp-qa-refresh-prod">Refresh Production</button>
        ${RecipePerms.can(this.user, 'create') ? '<button class="btn btn-ghost" id="rp-qa-recipe">Recipe Builder</button>' : ''}
        ${RecipePerms.can(this.user, 'produce') ? '<button class="btn btn-ghost" id="rp-qa-restock">Restock</button>' : ''}
        <button class="btn btn-ghost" id="rp-qa-ing">Ingredients</button>
        <button class="btn btn-ghost" id="rp-qa-rep">Reports</button>
      </div>
      <div class="rp-panel">
        <h3>Live Production Capacity</h3>
        <p class="rp-muted">POS sells by meals available (limiting ingredient), not raw ingredient stock. Fractional recipes (½ / ¼ chicken) share one master ingredient.</p>
        <table class="rp-table"><thead><tr>
          <th>Meal</th><th>Available</th><th>Limiting Ingredient</th><th>Status</th><th>Remaining by ingredient</th>
        </tr></thead>
        <tbody>${meals.map(m => `<tr>
          <td><strong>${m.name}</strong></td>
          <td>${m.available_meals} meals</td>
          <td>${m.limiting_ingredient || '—'}</td>
          <td>${m.out_of_stock ? `<span class="rp-tag danger">OUT OF STOCK</span>` : m.available_meals <= 5 ? `<span class="rp-tag warn">Low</span>` : `<span class="rp-tag ok">Ready</span>`}</td>
          <td class="rp-muted" style="font-size:12px">${(m.remaining_by_ingredient || []).map(r =>
            `${r.name}: ${r.meals_remaining} meals`).join(' · ') || '—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">Save meal recipes first — capacity appears automatically</td></tr>'}
        </tbody></table>
      </div>
      <div class="rp-grid-2">
        <div class="rp-panel"><h3>Products Automatically Disabled</h3>
          <table class="rp-table"><thead><tr><th>Meal</th><th>Reason</th></tr></thead>
          <tbody>${(prod.products_disabled || []).map(m => `<tr>
            <td>${m.name}</td><td>${m.reason || m.limiting_ingredient || '—'}</td>
          </tr>`).join('') || '<tr><td colspan="2" class="rp-muted">All meals can be produced</td></tr>'}</tbody></table>
        </div>
        <div class="rp-panel"><h3>Smart Restock Recommendations</h3>
          <p class="rp-muted">Only missing / limiting ingredients — skip what still has capacity.</p>
          ${(restock.length ? restock.map(r => `
            <div style="margin-bottom:12px;border-bottom:1px solid var(--rp-border);padding-bottom:10px">
              <strong>${r.product_name}</strong> <span class="rp-muted">(${r.current_meals} → target ${r.target_meals} meals)</span>
              <ul style="margin:6px 0 0;padding-left:18px">
                ${(r.purchase || []).map(p => `<li>Purchase <strong>${p.quantity} ${p.unit}</strong> ${p.name} <span class="rp-muted">— ${p.reason}</span></li>`).join('') || '<li class="rp-muted">Nothing to buy</li>'}
              </ul>
              ${(r.skip || []).length ? `<div class="rp-muted" style="font-size:12px;margin-top:4px">No need: ${(r.skip || []).map(s => s.name).join(', ')}</div>` : ''}
            </div>`).join('') : '<p class="rp-muted">No restock needed right now</p>')}
        </div>
        <div class="rp-panel"><h3>Ingredients Out of Stock</h3>
          <table class="rp-table"><thead><tr><th>Ingredient</th><th>Stock</th></tr></thead>
          <tbody>${(prod.ingredients_out_of_stock || []).map(i => `<tr><td>${i.name}</td><td>0 ${i.stock_unit || i.unit || ''}</td></tr>`).join('') || '<tr><td colspan="2" class="rp-muted">None</td></tr>'}</tbody></table>
        </div>
        <div class="rp-panel"><h3>Ingredients Running Low</h3>
          <table class="rp-table"><thead><tr><th>Ingredient</th><th>Stock</th></tr></thead>
          <tbody>${(prod.ingredients_running_low || []).map(i => `<tr><td>${i.name}</td><td>${i.stock_quantity} ${i.stock_unit || i.unit || ''}</td></tr>`).join('') || '<tr><td colspan="2" class="rp-muted">None</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="rp-grid-2">
        <div class="rp-panel"><h3>Best Sellers (30d)</h3>
          <table class="rp-table"><thead><tr><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
          <tbody>${(d.best_sellers || []).map(b => `<tr><td>${b.product_name}</td><td>${b.sold}</td><td>${this.money(b.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="rp-muted">No sales yet</td></tr>'}</tbody></table>
        </div>
        <div class="rp-panel"><h3>AI Suggestions</h3>
          ${ai.length ? ai.map((a, idx) => `<div class="rp-ai-item ${a.severity || ''}" data-ai-idx="${idx}">
            <strong>${a.title}</strong><div class="rp-muted">${a.message}</div>
            ${a.type === 'price_review' && a.suggested_price && (a.product_id || a.recipe_id) && RecipePerms.can(this.user, 'edit')
              ? `<button type="button" class="btn btn-sm btn-primary rp-ai-apply-price" style="margin-top:8px"
                  data-recipe="${a.recipe_id || ''}" data-product="${a.product_id || ''}" data-price="${a.suggested_price}">
                  Apply suggested sell price (${this.money(a.suggested_price)})
                </button>` : ''}
          </div>`).join('') : '<p class="rp-muted">No suggestions right now</p>'}
        </div>
      </div>
      <div class="rp-grid-2">
        <div class="rp-panel"><h3>Capacity Chart</h3>${this.barChart(meals.map(m => ({ name: m.name, max_meals: m.available_meals })), 'max_meals', 'name')}</div>
        <div class="rp-panel"><h3>Sales Chart</h3>${this.barChart(d.best_sellers, 'sold', 'product_name')}</div>
      </div>
      <div class="rp-panel"><h3>Recent Activity</h3>
        <table class="rp-table"><thead><tr><th>When</th><th>User</th><th>Action</th></tr></thead>
        <tbody>${(d.recent_activity || []).map(a => `<tr><td>${Utils.formatDateTime?.(a.created_at) || a.created_at}</td><td>${a.user_name || '—'}</td><td>${a.action}</td></tr>`).join('') || '<tr><td colspan="3" class="rp-muted">No activity</td></tr>'}</tbody></table>
      </div>`;
    document.getElementById('rp-qa-refresh-prod')?.addEventListener('click', async () => {
      const r = await API.recipeRefreshProduction(this.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Production capacity refreshed', 'success');
      this.pageDashboard(el);
    });
    document.getElementById('rp-qa-recipe')?.addEventListener('click', () => { this.page = 'recipes'; this._editingMealProductId = null; this.render(); });
    document.getElementById('rp-qa-restock')?.addEventListener('click', () => { this.page = 'restock'; this.render(); });
    document.getElementById('rp-qa-ing')?.addEventListener('click', () => { this.page = 'ingredients'; this.render(); });
    document.getElementById('rp-qa-rep')?.addEventListener('click', () => { this.page = 'reports'; this.render(); });
    el.querySelectorAll('.rp-ai-apply-price').forEach(btn => {
      btn.onclick = async () => {
        const res = await API.recipeApplySuggestedPrice({
          recipe_id: parseInt(btn.dataset.recipe, 10) || null,
          product_id: parseInt(btn.dataset.product, 10) || null,
          suggested_price: parseFloat(btn.dataset.price)
        }, this.user);
        if (!res.success) return Utils.toast(res.error || 'Could not apply price', 'error');
        Utils.toast(`Sell price updated to ${this.money(res.data?.selling_price || btn.dataset.price)}`, 'success');
        this.pageDashboard(el);
      };
    });
  },

  /* ── Ingredients ───────────────────────────────────────────────────────── */
  async pagePrepBoard(el) {
    const res = await API.recipePrepBoard(this.user);
    if (!res.success) throw new Error(res.error || 'Prep board failed');
    const b = res.data || {};
    const card = (m) => `
      <article class="rp-prep-card" data-path="${this.escapeAttr(m.picture_path || '')}">
        <div class="rp-prep-card-media">${m.picture_path ? '<span class="rp-prep-ph">…</span>' : '<div class="rp-prep-ph-empty">Prep</div>'}</div>
        <div class="rp-prep-card-body">
          <strong>${m.name}</strong>
          <div class="rp-muted">${m.production_capacity ?? 0} meals · ${m.prep_time_minutes || 0}+${m.cook_time_minutes || 0} min</div>
          ${m.allergens ? `<div class="rp-allergen">Allergens: ${this.escapeAttr(m.allergens)}</div>` : ''}
          <div class="rp-prep-steps">${(m.instructions || m.kitchen_notes || 'No prep steps yet')
            .split(/\n+|·|\u2022/).map(s => s.trim()).filter(Boolean).slice(0, 5)
            .map((s, i) => `<div class="rp-prep-step"><span>${i + 1}</span>${this.escapeAttr(s)}</div>`).join('') || '<div class="rp-muted">—</div>'}
          </div>
        </div>
      </article>`;
    const section = (title, rows, empty) => `
      <div class="rp-panel"><h3>${title}</h3>
        ${!(rows || []).length ? `<p class="rp-muted">${empty}</p>` : `
        <div class="rp-prep-grid">${rows.map(card).join('')}</div>
        <table class="rp-table" style="margin-top:12px"><thead><tr>
          <th>Meal</th><th>Available</th><th>Limiting</th><th>Prep</th><th>Allergens</th><th>Kitchen notes</th>
        </tr></thead><tbody>
          ${rows.map(m => `<tr>
            <td><strong>${m.name}</strong></td>
            <td>${m.production_capacity ?? 0} meals</td>
            <td class="rp-muted">${m.limiting_ingredient_name || '—'}</td>
            <td class="rp-muted">${m.prep_time_minutes || 0} + ${m.cook_time_minutes || 0} min</td>
            <td class="rp-muted">${m.allergens || '—'}</td>
            <td class="rp-muted">${m.kitchen_notes || m.instructions || '—'}</td>
          </tr>`).join('')}
        </tbody></table>`}
      </div>`;
    el.innerHTML = `
      <p class="rp-muted" style="margin-top:0">Daily kitchen board for ${b.date || 'today'} — photo step cards, allergens, and a 7-day prep schedule from forecast.</p>
      <div class="rp-cards">
        <div class="rp-card"><div class="label">Available Today</div><div class="value">${b.totals?.available_today || 0}</div></div>
        <div class="rp-card"><div class="label">Low capacity</div><div class="value">${b.totals?.low || 0}</div></div>
        <div class="rp-card"><div class="label">Out of stock</div><div class="value">${b.totals?.oos || 0}</div></div>
      </div>
      <div class="rp-toolbar">
        <button class="btn btn-primary" id="rp-prep-refresh">Refresh</button>
        <button class="btn btn-ghost" id="rp-prep-settings">Set Available Today…</button>
        ${this.docActionsHtml('rp-prep')}
      </div>
      <div class="rp-panel">
        <h3>Production calendar / prep schedule</h3>
        <div class="rp-prep-calendar">
          ${(b.prep_schedule || []).map(day => `
            <div class="rp-prep-day ${day.date === b.date ? 'is-today' : ''}">
              <div class="rp-prep-day-head"><strong>${day.weekday}</strong><span class="rp-muted">${day.date}</span></div>
              <ul>${(day.meals || []).slice(0, 4).map(m => `<li>${m.name}${m.allergens ? ` <span class="rp-allergen-chip">${this.escapeAttr(m.allergens)}</span>` : ''}</li>`).join('') || '<li class="rp-muted">No Available Today meals</li>'}</ul>
              ${(day.restock_focus || []).length ? `<div class="rp-muted" style="font-size:11px;margin-top:6px">Restock focus: ${day.restock_focus.map(f => f.name).join(', ')}</div>` : ''}
            </div>`).join('') || '<p class="rp-muted">No schedule yet</p>'}
        </div>
      </div>
      ${section('Photo step cards — Available Today', b.available_today, 'Mark meals as Available Today in Settings.')}
      ${section('Almost out (≤5 meals)', b.low_capacity, 'None running low.')}
      ${section('Out of stock / cannot make', b.out_of_stock, 'All meals can still be made.')}`;
    const prepRows = [
      ...(b.available_today || []).map(m => ({ section: 'Available Today', meal: m.name, available: m.production_capacity ?? 0, limiting: m.limiting_ingredient_name || '—', prep_min: `${m.prep_time_minutes || 0}+${m.cook_time_minutes || 0}`, allergens: m.allergens || '', notes: m.kitchen_notes || m.instructions || '' })),
      ...(b.low_capacity || []).map(m => ({ section: 'Low capacity', meal: m.name, available: m.production_capacity ?? 0, limiting: m.limiting_ingredient_name || '—', prep_min: `${m.prep_time_minutes || 0}+${m.cook_time_minutes || 0}`, allergens: m.allergens || '', notes: m.kitchen_notes || m.instructions || '' })),
      ...(b.out_of_stock || []).map(m => ({ section: 'Out of stock', meal: m.name, available: m.production_capacity ?? 0, limiting: m.limiting_ingredient_name || '—', prep_min: `${m.prep_time_minutes || 0}+${m.cook_time_minutes || 0}`, allergens: m.allergens || '', notes: m.kitchen_notes || m.instructions || '' }))
    ];
    this.bindDocActions('rp-prep', () => ({
      title: `Daily Prep Board — ${b.date || 'today'}`,
      filename: `prep-board-${b.date || 'today'}.pdf`,
      rows: prepRows,
      keys: ['section', 'meal', 'available', 'limiting', 'prep_min', 'allergens', 'notes']
    }));
    el.querySelectorAll('.rp-prep-card[data-path]').forEach(async (cardEl) => {
      const path = cardEl.dataset.path;
      if (!path) return;
      try {
        const img = await API.getImageDataUrl(path);
        const media = cardEl.querySelector('.rp-prep-card-media');
        if (media && img.success && (img.dataUrl || img.data)) {
          media.innerHTML = `<img src="${img.dataUrl || img.data}" alt="">`;
        }
      } catch (_) { /* ignore */ }
    });
    document.getElementById('rp-prep-refresh')?.addEventListener('click', () => this.pagePrepBoard(el));
    document.getElementById('rp-prep-settings')?.addEventListener('click', () => {
      this.page = 'settings';
      this.render();
    });
  },

  async pageIngredients(el) {
    // Always load from saved/edited recipes (same source as Restock) — never a stale cache
    this._ingredients = [];
    const listRes = await API.recipeRestockList(this.user);
    if (!listRes.success) throw new Error(listRes.error || 'Failed to load ingredients');
    let list = listRes.data || [];
    const q = (this._ingSearch || '').trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.used_in_meals || '').toLowerCase().includes(q)
      );
    }
    if (this._ingFilter === 'low') {
      list = list.filter(p => (p.stock_quantity || 0) > 0 && (p.stock_quantity || 0) <= (p.min_stock || 5));
    }
    if (this._ingFilter === 'out') {
      list = list.filter(p => (p.stock_quantity || 0) <= 0);
    }
    if (this._ingFilter === 'recipe') {
      list = list.filter(p => p.from_recipe);
    }
    this._ingredients = list;
    const onRecipe = list.filter(p => p.from_recipe).length;
    const canEdit = RecipePerms.can(this.user, 'edit') || RecipePerms.can(this.user, 'create') || RecipePerms.can(this.user, 'produce');
    el.innerHTML = `
      <p class="rp-muted" style="margin-top:0">
        One shared ingredient list for all meals. In <strong>Recipe Builder</strong>, pick a saved ingredient and set a
        different amount per meal — Restock, Prep Board, and POS capacity all use the same stock.
      </p>
      <div class="rp-toolbar">
        <input id="rp-ing-search" placeholder="Search ingredient or meal…" value="${this._ingSearch || ''}" style="min-width:220px">
        <button class="btn btn-ghost ${this._ingFilter === 'recipe' ? 'btn-primary' : ''}" id="rp-ing-recipe">On recipes (${onRecipe})</button>
        <button class="btn btn-ghost ${this._ingFilter === 'low' ? 'btn-primary' : ''}" id="rp-ing-low">Low Stock</button>
        <button class="btn btn-ghost ${this._ingFilter === 'out' ? 'btn-primary' : ''}" id="rp-ing-out">Out of Stock</button>
        <button class="btn btn-primary" id="rp-ing-refresh">Refresh</button>
        ${canEdit ? '<button class="btn btn-ghost" id="rp-ing-add">+ Add ingredient</button>' : ''}
        <button class="btn btn-ghost" id="rp-ing-goto-recipes">Recipe Builder…</button>
        <button class="btn btn-ghost" id="rp-ing-goto-restock">Restock…</button>
        ${this.docActionsHtml('rp-ing')}
      </div>
      <div class="rp-panel" style="padding:0;overflow:auto">
        <table class="rp-table">
          <thead><tr>
            <th>Ingredient</th><th>Used in meals</th><th>Stock</th><th>Unit</th>
            <th>Recipe unit</th><th>Avg cost</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>${list.map(p => `<tr data-id="${p.id}">
            <td><strong>${p.name}</strong>
              ${p.from_recipe ? '<span class="rp-tag ok">Shared</span>' : '<span class="rp-tag">Ready to use</span>'}</td>
            <td class="rp-muted">${p.used_in_meals || '— (pick in Recipe Builder)'}</td>
            <td><strong>${p.stock_quantity}</strong> <span class="rp-muted">left</span></td>
            <td>${p.stock_unit || p.unit || 'each'}${p.purchase_unit_label || (p.purchase_unit && p.purchase_unit !== (p.stock_unit || p.unit))
              ? ` <span class="rp-muted">· ${p.purchase_unit_label || p.purchase_unit}${p.purchase_unit_qty > 1 ? `×${p.purchase_unit_qty}` : ''}</span>`
              : ''}</td>
            <td>${p.recipe_unit || '—'} <span class="rp-muted">${p.purchase_unit && p.purchase_unit !== (p.stock_unit || p.unit) ? `(buy: ${p.purchase_unit})` : ''}</span></td>
            <td>${this.money(p.buying_price)}</td>
            <td>${p.stock_quantity <= 0 ? '<span class="rp-tag danger">Out</span>' : p.stock_quantity <= (p.min_stock || 5) ? '<span class="rp-tag warn">Low</span>' : '<span class="rp-tag ok">OK</span>'}</td>
            <td class="actions" style="white-space:nowrap">
              <button type="button" class="btn btn-sm btn-ghost rp-ing-hist" data-id="${p.id}">History</button>
              ${canEdit ? `<button type="button" class="btn btn-sm btn-ghost rp-ing-edit" data-id="${p.id}">Edit</button>
              <button type="button" class="btn btn-sm btn-danger rp-ing-del" data-id="${p.id}">Delete</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="8" class="rp-muted">No ingredients yet. Add one here, or save a recipe in Recipe Builder.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="rp-panel">
        <h3>Usage history (date filter)</h3>
        <div class="rp-toolbar">
          <label class="rp-muted">From</label><input type="date" id="rp-ing-hist-from" value="${this._ingHistFrom || new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA')}">
          <label class="rp-muted">To</label><input type="date" id="rp-ing-hist-to" value="${this._ingHistTo || new Date().toLocaleDateString('en-CA')}">
          <button class="btn btn-ghost btn-sm" id="rp-ing-hist-run">Show stock used</button>
        </div>
        <div id="rp-ing-hist-out"><p class="rp-muted">Filter by date to see stock used per ingredient. Suggestions: Restock low items, set min stock, track waste photos, open Profits &amp; Losses.</p></div>
      </div>`;
    this.bindDocActions('rp-ing', () => ({
      title: 'Ingredient Master',
      filename: `ingredients-${Date.now()}.pdf`,
      rows: (list || []).map(p => ({
        name: p.name,
        used_in: p.used_in_meals || '',
        stock: p.stock_quantity,
        unit: p.stock_unit || p.unit || '',
        recipe_unit: p.recipe_unit || '',
        avg_cost: p.buying_price,
        status: p.stock_quantity <= 0 ? 'Out' : p.stock_quantity <= (p.min_stock || 5) ? 'Low' : 'OK'
      })),
      keys: ['name', 'used_in', 'stock', 'unit', 'recipe_unit', 'avg_cost', 'status']
    }));
    document.getElementById('rp-ing-search').onkeydown = (e) => {
      if (e.key === 'Enter') {
        this._ingSearch = e.target.value;
        this.pageIngredients(el);
      }
    };
    document.getElementById('rp-ing-refresh').onclick = () => {
      this._ingSearch = document.getElementById('rp-ing-search').value;
      this._ingredients = [];
      this.pageIngredients(el);
    };
    document.getElementById('rp-ing-recipe').onclick = () => {
      this._ingFilter = this._ingFilter === 'recipe' ? null : 'recipe';
      this.pageIngredients(el);
    };
    document.getElementById('rp-ing-low').onclick = () => {
      this._ingSearch = '';
      this._ingFilter = this._ingFilter === 'low' ? null : 'low';
      this.pageIngredients(el);
    };
    document.getElementById('rp-ing-out').onclick = () => {
      this._ingSearch = '';
      this._ingFilter = this._ingFilter === 'out' ? null : 'out';
      this.pageIngredients(el);
    };
    document.getElementById('rp-ing-goto-restock').onclick = () => {
      this.page = 'restock';
      this.render();
    };
    document.getElementById('rp-ing-goto-recipes').onclick = () => {
      this.page = 'recipes';
      this.render();
    };
    document.getElementById('rp-ing-hist-run')?.addEventListener('click', async () => {
      this._ingHistFrom = document.getElementById('rp-ing-hist-from').value;
      this._ingHistTo = document.getElementById('rp-ing-hist-to').value;
      const res = await API.recipeIngredientStockHistory({
        from: this._ingHistFrom, to: this._ingHistTo
      }, this.user);
      const box = document.getElementById('rp-ing-hist-out');
      if (!res.success) return box.innerHTML = `<p class="error-msg">${res.error}</p>`;
      const summary = res.data?.summary || [];
      box.innerHTML = `<table class="rp-table"><thead><tr><th>Ingredient</th><th>Stock left</th><th>Used in range</th><th>Added</th></tr></thead>
        <tbody>${summary.map(s => `<tr>
          <td>${s.product_name}</td><td><strong>${s.stock_left}</strong> ${s.unit || ''}</td>
          <td>${s.qty_used}</td><td>${s.qty_added}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="rp-muted">No usage in this date range</td></tr>'}</tbody></table>`;
    });
    document.getElementById('rp-ing-add')?.addEventListener('click', async () => {
      const name = prompt('Ingredient name (shared across meals):');
      if (!name?.trim()) return;
      const unit = prompt('Default unit (g, ml, each…)', 'g') || 'g';
      const r = await API.recipeEnsureIngredient({ name: name.trim(), unit: unit.trim() || 'g' }, this.user);
      if (!r.success) return Utils.toast(r.error || 'Could not add ingredient', 'error');
      Utils.toast(`Saved "${r.data?.name || name}" — reuse it in Recipe Builder with each meal’s amount`, 'success');
      this._ingredients = [];
      this.pageIngredients(el);
    });
    el.querySelectorAll('.rp-ing-hist').forEach(btn => btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const from = this._ingHistFrom || new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA');
      const to = this._ingHistTo || new Date().toLocaleDateString('en-CA');
      const res = await API.recipeIngredientStockHistory({ product_id: id, from, to }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      const moves = res.data?.movements || [];
      Utils.showModal('Ingredient stock history', `
        <p class="rp-muted">${from} → ${to}</p>
        <table class="rp-table"><thead><tr><th>When</th><th>Type</th><th>Qty</th><th>Stock after</th><th>Notes</th></tr></thead>
        <tbody>${moves.map(m => `<tr>
          <td>${m.created_at}</td><td>${m.movement_type}</td><td>${m.quantity}</td>
          <td>${m.new_stock}</td><td>${m.notes || '—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No movements</td></tr>'}</tbody></table>
      `, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    }));
    el.querySelectorAll('.rp-ing-edit').forEach(btn => btn.addEventListener('click', async () => {
      const p = list.find(x => Number(x.id) === Number(btn.dataset.id));
      if (!p) return;
      const fullRes = await API.getProduct(p.id);
      const full = fullRes.success ? (fullRes.data || p) : p;
      const stockUnit = full.stock_unit || full.unit || 'g';
      const units = Utils.getAllStockUnits();
      const unitOpts = (sel) => units.map(u => `<option value="${u}" ${u === sel ? 'selected' : ''}>${u}</option>`).join('');
      let convs = (full.conversions || []).map(c => ({
        from_qty: Number(c.from_qty) > 0 ? Number(c.from_qty) : 1,
        from_unit: c.from_unit || '',
        to_qty: Number(c.to_qty) > 0 ? Number(c.to_qty) : 1,
        to_unit: c.to_unit || stockUnit,
        label: c.label || ''
      }));
      Utils.showModal('Edit Ingredient', `
        <div class="form-grid">
          <div class="field"><label>Name</label><input id="rp-ie-name" value="${this.escapeAttr(full.name || p.name)}"></div>
          <div class="field"><label>Stock unit</label><select id="rp-ie-unit">${unitOpts(stockUnit)}</select></div>
          <div class="field"><label>Min stock</label><input type="number" id="rp-ie-min" step="0.001" value="${full.min_stock ?? p.min_stock ?? 5}"></div>
          <div class="field"><label>Avg / buy cost</label><input type="number" id="rp-ie-cost" step="0.01" value="${full.buying_price || p.buying_price || 0}"></div>
        </div>
        <h4 style="margin:16px 0 8px">Package (how you buy)</h4>
        <p class="rp-muted" style="margin:0 0 8px">Example: Case of 10 kg — restock 1 case adds 10 kg to stock.</p>
        <div class="form-grid">
          <div class="field"><label>Package name</label>
            <input id="rp-ie-pack-label" list="rp-ie-pack-presets" value="${this.escapeAttr(full.purchase_unit_label || '')}" placeholder="Case, Box, Bag…">
            <datalist id="rp-ie-pack-presets"><option value="Case"><option value="Box"><option value="Bag"><option value="Pack"><option value="Carton"></datalist>
          </div>
          <div class="field"><label>Contains</label><input type="number" id="rp-ie-pack-qty" step="0.001" min="0.001" value="${full.purchase_unit_qty > 0 ? full.purchase_unit_qty : 1}"></div>
          <div class="field"><label>Purchase unit</label><select id="rp-ie-purchase">${unitOpts(full.purchase_unit || 'case')}</select></div>
        </div>
        <h4 style="margin:16px 0 8px">Extra conversions</h4>
        <div id="rp-ie-conv"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="rp-ie-add-conv" style="margin-top:6px">+ Add conversion</button>
        <p class="rp-muted" style="margin-top:12px">Used in: ${p.used_in_meals || '—'}</p>`,
        '<button class="btn btn-primary" id="rp-ie-save">Save</button>');
      const drawConv = () => {
        const box = document.getElementById('rp-ie-conv');
        if (!box) return;
        box.innerHTML = convs.map((c, i) => `
          <div class="form-grid" style="margin-bottom:6px;align-items:end">
            <div class="field"><label>From</label><input type="number" class="ie-fq" data-i="${i}" step="0.001" value="${c.from_qty}"></div>
            <div class="field"><label>Unit</label><input class="ie-fu" data-i="${i}" value="${this.escapeAttr(c.from_unit)}"></div>
            <div class="field"><label>= To</label><input type="number" class="ie-tq" data-i="${i}" step="0.001" value="${c.to_qty}"></div>
            <div class="field"><label>Unit</label><input class="ie-tu" data-i="${i}" value="${this.escapeAttr(c.to_unit)}"></div>
            <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger ie-crm" data-i="${i}">×</button></div>
          </div>`).join('') || '<p class="rp-muted">No extra conversions</p>';
        box.querySelectorAll('.ie-fq').forEach(inp => inp.oninput = () => { convs[inp.dataset.i].from_qty = parseFloat(inp.value) || 1; });
        box.querySelectorAll('.ie-fu').forEach(inp => inp.oninput = () => { convs[inp.dataset.i].from_unit = inp.value; });
        box.querySelectorAll('.ie-tq').forEach(inp => inp.oninput = () => { convs[inp.dataset.i].to_qty = parseFloat(inp.value) || 1; });
        box.querySelectorAll('.ie-tu').forEach(inp => inp.oninput = () => { convs[inp.dataset.i].to_unit = inp.value; });
        box.querySelectorAll('.ie-crm').forEach(b => b.onclick = () => { convs.splice(parseInt(b.dataset.i, 10), 1); drawConv(); });
      };
      drawConv();
      document.getElementById('rp-ie-add-conv')?.addEventListener('click', () => {
        convs.push({ from_qty: 1, from_unit: 'kg', to_qty: 1000, to_unit: document.getElementById('rp-ie-unit')?.value || 'g', label: '' });
        drawConv();
      });
      document.getElementById('rp-ie-save').onclick = async () => {
        const r = await API.recipeUpdateIngredient({
          id: p.id,
          name: document.getElementById('rp-ie-name').value.trim(),
          unit: document.getElementById('rp-ie-unit').value.trim() || 'g',
          min_stock: parseFloat(document.getElementById('rp-ie-min').value) || 0,
          buying_price: parseFloat(document.getElementById('rp-ie-cost').value) || 0,
          purchase_unit_label: document.getElementById('rp-ie-pack-label').value.trim() || null,
          purchase_unit_qty: parseFloat(document.getElementById('rp-ie-pack-qty').value) || 1,
          purchase_unit: document.getElementById('rp-ie-purchase').value.trim() || null,
          conversions: convs
        }, this.user);
        if (!r.success) return Utils.toast(r.error || 'Update failed', 'error');
        Utils.hideModal();
        Utils.toast('Ingredient updated', 'success');
        this._ingredients = [];
        this.pageIngredients(el);
      };
    }));
    el.querySelectorAll('.rp-ing-del').forEach(btn => btn.addEventListener('click', async () => {
      const p = list.find(x => Number(x.id) === Number(btn.dataset.id));
      if (!p) return;
      if (!confirm(`Delete ingredient "${p.name}"?`)) return;
      const r = await API.recipeDeleteIngredient(p.id, this.user);
      if (!r.success) return Utils.toast(r.error || 'Delete failed', 'error');
      Utils.toast('Ingredient deleted', 'success');
      this._ingredients = [];
      this.pageIngredients(el);
    }));
  },

  /* ── Recipes (product-first: click meal → add ingredients for ONE meal) ─── */
  async pageRecipes(el) {
    if (this._editingMealProductId) {
      return this.renderMealRecipeEditor(el, this._editingMealProductId);
    }
    if (this._useLegacyEditor && this._editingRecipe) {
      return this.renderRecipeEditor(el, this._editingRecipe);
    }

    const filter = this._mealFilter || '';
    const filters = { search: filter || undefined };
    if (this._mealRecipeFilter === 'with') filters.with_recipe = true;
    if (this._mealRecipeFilter === 'without') filters.with_recipe = false;
    const res = await API.recipeMealProducts({ ...filters, ...this.branchFilter() }, this.user);
    if (!res.success) throw new Error(res.error || 'Failed to load products');
    const products = res.data || [];

    el.innerHTML = `
      <p class="rp-muted" style="margin-top:0">
        <strong>How it works:</strong> Click a meal already in POS (e.g. Quarter Chicken).
        Add each ingredient you use for <em>one</em> meal (chicken piece, oil, paprika, spice — with amounts).
        Save. When POS sells that meal, stock is deducted from those ingredients.
        Use <strong>Restock Ingredients</strong> when you buy oil by the litre, spice by the gram, etc.
      </p>
      <div class="rp-toolbar">
        <input id="rp-meal-q" placeholder="Search products / meals…" value="${filter}" style="min-width:240px">
        <button class="btn btn-primary" id="rp-meal-refresh">Refresh</button>
        <select id="rp-meal-filter">
          <option value="">All products</option>
          <option value="with" ${this._mealRecipeFilter === 'with' ? 'selected' : ''}>With recipe</option>
          <option value="without" ${this._mealRecipeFilter === 'without' ? 'selected' : ''}>No recipe yet</option>
        </select>
      </div>
      <div class="rp-meal-grid" id="rp-meal-grid">
        ${products.map(p => `
          <button type="button" class="rp-meal-card" data-id="${p.id}">
            <div class="rp-meal-card-media">${p.picture_path
              ? `<img src="${p.picture_path}" alt="">`
              : `<span>${(p.name || '?').charAt(0)}</span>`}</div>
            <div class="rp-meal-card-body">
              <strong>${p.name}</strong>
              <span class="rp-muted">${p.category_name || 'Uncategorised'} · ${this.money(p.selling_price)}</span>
              <span>${Number(p.ingredient_count) > 0
                ? `<span class="rp-tag ok">${p.ingredient_count} ingredient(s)</span>`
                : `<span class="rp-tag warn">No recipe</span>`}</span>
            </div>
          </button>`).join('') || '<p class="rp-muted">No products found. Add meals in POS Products first.</p>'}
      </div>`;

    const reload = async () => {
      this._mealFilter = document.getElementById('rp-meal-q').value.trim();
      this._mealRecipeFilter = document.getElementById('rp-meal-filter').value;
      this.pageRecipes(el);
    };
    const bindCards = () => {
      el.querySelectorAll('.rp-meal-card').forEach(b => b.onclick = () => {
        this._editingMealProductId = parseInt(b.dataset.id, 10);
        this._editingRecipe = null;
        this._useLegacyEditor = false;
        this.renderMealRecipeEditor(el, this._editingMealProductId);
      });
    };
    document.getElementById('rp-meal-q').onkeydown = (e) => { if (e.key === 'Enter') reload(); };
    document.getElementById('rp-meal-refresh').onclick = reload;
    document.getElementById('rp-meal-filter').onchange = reload;
    bindCards();
  },

  escapeAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  async renderMealRecipeEditor(el, productId) {
    this._editingMealProductId = productId;
    const res = await API.recipeGetMeal(productId, this.user);
    if (!res.success) throw new Error(res.error || 'Could not open product');
    const meal = res.data;
    const product = meal.product;
    // Saved ingredients catalog — reuse across meals; only amount changes per meal
    const catRes = await API.recipeRestockList(this.user);
    let catalog = (catRes.success ? (catRes.data || []) : [])
      .filter(c => c && (c.from_recipe || c.item_type === 'ingredient' || !c.selling_price || Number(c.selling_price) === 0 || c.recipe_unit))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    // Prefer dedicated ingredients; keep any restock-listed shared stock so recipes still work
    if (!catalog.length && catRes.success) catalog = (catRes.data || []).slice();
    const catalogById = () => {
      const m = new Map();
      catalog.forEach(c => m.set(Number(c.id), c));
      return m;
    };
    const findCatalogByName = (name) => {
      const key = String(name || '').trim().toLowerCase();
      if (!key) return null;
      return catalog.find(c => String(c.name || '').trim().toLowerCase() === key) || null;
    };
    let items = (meal.items || []).map(i => ({
      ingredient_product_id: i.ingredient_product_id || null,
      ingredient_name: i.ingredient_name || '',
      quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1,
      unit: i.unit || 'g',
      waste_pct: i.waste_pct || 0,
      include_rule: i.include_rule || 'always',
      option_name: i.option_name || '',
      is_primary: !!Number(i.is_primary),
      cost_used: i.cost_used,
      current_stock: i.current_stock
    }));
    const canEdit = RecipePerms.can(this.user, 'edit') || RecipePerms.can(this.user, 'create');
    const unitSuggestions = ['g', 'kg', 'ml', 'L', 'litre', 'tsp', 'tbsp', 'cup', 'each', 'piece', 'pinch', 'slice'];
    const optionSuggestions = [
      ...(meal.options || []).map(o => o.name),
      ...(meal.removals || []).map(o => o.name),
      'With Pap', 'Without Pap', 'With Salad', 'Without Salad'
    ].filter((v, i, a) => v && a.indexOf(v) === i);
    let targetProfit = meal.recipe_profile?.target_profit_pct ?? 40;
    let dirty = false;
    let saving = false;
    const savedSnapshot = () => JSON.stringify(items.map(i => ({
      id: Number(i.ingredient_product_id) || 0,
      n: (i.ingredient_name || '').trim().toLowerCase(),
      q: Number(i.quantity) || 0,
      u: (i.unit || '').trim().toLowerCase(),
      r: i.include_rule || 'always',
      o: (i.option_name || '').trim().toLowerCase()
    })).filter(i => (i.id || i.n) && i.q > 0));
    let cleanSnapshot = savedSnapshot();

    const setDirty = (isDirty) => {
      dirty = !!isDirty;
      const tag = document.getElementById('rr-dirty-tag');
      const saveBtn = document.getElementById('rr-save-meal');
      if (tag) {
        tag.className = dirty ? 'rp-tag warn' : 'rp-tag ok';
        tag.textContent = dirty ? 'Unsaved changes' : (items.some(i => i.ingredient_name) ? 'Saved' : 'New recipe');
      }
      if (saveBtn && canEdit) {
        saveBtn.disabled = saving;
        saveBtn.textContent = saving ? 'Saving…' : (dirty ? 'Save changes' : 'Save recipe');
        saveBtn.classList.toggle('btn-primary', true);
      }
    };

    el.innerHTML = `
      <div class="rp-toolbar">
        <button class="btn btn-ghost" id="rp-back-meals">← Back to products</button>
        <span class="rp-tag ok">Per 1 meal sold</span>
        <span class="rp-tag ok" id="rr-dirty-tag">${items.length ? 'Saved' : 'New recipe'}</span>
      </div>
      <div class="rp-panel">
        <h3>${this.escapeAttr(product.name)}</h3>
        <p class="rp-muted" style="margin:0">
          Sell price ${this.money(product.selling_price)} · ${product.category_name || 'No category'} ·
          Reuse saved ingredients and set the amount for <strong>this meal only</strong> — shared stock stays linked.
        </p>
        <p class="rp-muted" id="rr-saved-summary" style="margin:8px 0 0">
          ${items.length
            ? `Currently saved: <strong>${items.length}</strong> ingredient(s) — ${items.map(i => `${i.ingredient_name} ${i.quantity} ${i.unit}`).join(' · ')}`
            : 'No ingredients saved yet for this meal.'}
        </p>
        <div class="form-grid" style="margin-top:12px">
          <div class="field"><label>Production mode</label>
            <select id="rr-prod-mode" ${canEdit ? '' : 'disabled'}>
              <option value="make_to_order" ${(meal.recipe_profile?.production_mode || 'make_to_order') !== 'make_to_stock' ? 'selected' : ''}>Make to order (deduct ingredients on POS sale)</option>
              <option value="make_to_stock" ${meal.recipe_profile?.production_mode === 'make_to_stock' ? 'selected' : ''}>Make to stock (deduct when you Produce)</option>
            </select></div>
          <div class="field" style="flex:2"><label>Kitchen notes</label>
            <textarea id="rr-kitchen" rows="2" ${canEdit ? '' : 'readonly'} placeholder="Serve hot · Plate garnish…">${this.escapeAttr(meal.recipe_profile?.notes || '')}</textarea></div>
          <div class="field" style="flex:2"><label>Allergen labels</label>
            <input id="rr-allergens" ${canEdit ? '' : 'readonly'} placeholder="e.g. Dairy, Gluten, Peanuts"
              value="${this.escapeAttr(meal.recipe_profile?.allergens || product.allergens || '')}">
            <small class="rp-muted">Shown on prep board, kitchen ticket, and receipt</small></div>
          <div class="field" style="flex:2"><label>Prep instructions</label>
            <textarea id="rr-instructions" rows="2" ${canEdit ? '' : 'readonly'} placeholder="Short kitchen steps…">${this.escapeAttr(meal.recipe_profile?.instructions || product.description || '')}</textarea></div>
        </div>
        <div class="rp-toolbar" style="margin-top:10px">
          <label class="rp-muted">Scale recipe for</label>
          <input type="number" id="rr-scale" min="1" step="1" value="1" style="width:70px" ${canEdit ? '' : 'disabled'}>
          <span class="rp-muted">portions (preview only — save always stores per 1 meal)</span>
          <button type="button" class="btn btn-sm btn-ghost" id="rr-scale-apply" ${canEdit ? '' : 'disabled'}>Preview amounts</button>
          <button type="button" class="btn btn-sm btn-ghost" id="rr-scale-reset" ${canEdit ? '' : 'disabled'}>Back to 1 meal</button>
        </div>
        ${meal.availability ? `
        <div class="rp-cost-box" style="margin-top:12px">
          <div><div class="rp-muted">POS available now</div><strong>${meal.availability.available_meals || 0} meals</strong></div>
          <div><div class="rp-muted">Limiting ingredient</div><strong>${meal.availability.limiting_ingredient_name || '—'}</strong></div>
          <div><div class="rp-muted">Status</div><strong>${meal.availability.out_of_stock ? 'OUT OF STOCK' : 'Ready'}</strong></div>
        </div>
        ${meal.availability.out_of_stock ? `<p class="rp-muted" style="margin:8px 0 0">${meal.availability.out_of_stock_reason || ''}</p>` : ''}
        ${(meal.availability.remaining_by_ingredient || []).length ? `
          <p class="rp-muted" style="margin:10px 0 4px">Remaining capacity by ingredient</p>
          <ul style="margin:0;padding-left:18px">${meal.availability.remaining_by_ingredient.map(r =>
            `<li>${r.name}: <strong>${r.meals_remaining}</strong> meals${r.is_missing ? ' (missing)' : ''}</li>`).join('')}</ul>` : ''}
        ` : ''}
      </div>
      <div class="rp-panel">
        <h3>Ingredients for one ${this.escapeAttr(product.name)}</h3>
        <p class="rp-muted">
          Pick a <strong>saved ingredient</strong>, set <strong>Amount for 1 meal</strong>.
          Mark one line as <strong>Main</strong> — POS stock available follows that ingredient only;
          other lines show how many times they can cover the main. Leave Main unchecked to use the limiting (lowest) ingredient.
        </p>
        ${canEdit && catalog.length ? `
        <div class="rp-panel" style="margin:0 0 12px;padding:12px;background:var(--rp-surface-2, transparent);border:1px dashed var(--rp-border)">
          <p class="rp-muted" style="margin:0 0 8px"><strong>Choose ingredients:</strong> search → multi-select from Ingredient Master → Add selected. Or copy another meal’s recipe.</p>
          <div class="rp-toolbar" style="margin-bottom:8px;flex-wrap:wrap">
            <input type="search" id="rr-ing-filter" placeholder="Search ingredients…" style="min-width:200px;flex:1" autocomplete="off">
            <button type="button" class="btn btn-sm btn-ghost" id="rr-pick-all-vis">Select visible</button>
            <button type="button" class="btn btn-sm btn-ghost" id="rr-pick-clear">Clear</button>
            <button type="button" class="btn btn-sm btn-primary" id="rr-add-selected">Add selected</button>
          </div>
          <div id="rr-recent-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
          <select id="rr-pick-multi" multiple size="7" style="width:100%;min-height:140px"></select>
          <div class="rp-toolbar" style="margin-top:10px;flex-wrap:wrap">
            <label class="rp-muted">Copy from meal</label>
            <select id="rr-copy-meal" style="min-width:220px"><option value="">Choose a meal with a recipe…</option></select>
            <button type="button" class="btn btn-sm btn-ghost" id="rr-copy-apply">Copy ingredients</button>
            <button type="button" class="btn btn-sm btn-ghost" id="rr-bulk-toggle">Bulk paste…</button>
          </div>
          <div id="rr-bulk-box" style="display:none;margin-top:8px">
            <textarea id="rr-bulk-text" rows="4" placeholder="One per line: Chicken breast, 150, g&#10;Oil, 10, ml&#10;Paprika, 5, g" style="width:100%"></textarea>
            <button type="button" class="btn btn-sm btn-primary" id="rr-bulk-apply" style="margin-top:6px">Parse &amp; add lines</button>
          </div>
        </div>` : (canEdit ? `
        <div class="rp-panel" style="margin:0 0 12px;padding:12px;border:1px dashed var(--rp-border)">
          <p class="rp-muted" style="margin:0">No saved ingredients yet. Go to <strong>Ingredient Master</strong> to add chicken, oil, spices, etc., then come back and multi-select them here.</p>
          <button type="button" class="btn btn-primary btn-sm" id="rr-goto-ing-master" style="margin-top:8px">Open Ingredient Master</button>
        </div>` : '')}
        <datalist id="rr-ing-list">${catalog.map(c => `<option value="${this.escapeAttr(c.name)}"></option>`).join('')}</datalist>
        <datalist id="rr-unit-list">${unitSuggestions.map(u => `<option value="${u}">`).join('')}</datalist>
        <datalist id="rr-option-list">${optionSuggestions.map(u => `<option value="${this.escapeAttr(u)}">`).join('')}</datalist>
        <div id="rr-items"></div>
        ${canEdit ? '<button type="button" class="btn btn-ghost btn-sm" id="rr-add-item">+ Add next ingredient</button>' : ''}
        <div class="form-grid" style="margin-top:14px;max-width:280px">
          <div class="field"><label>Desired profit % (on cost)</label>
            <input type="number" id="rr-target-profit" step="1" value="${targetProfit}">
          </div>
        </div>
        <div class="rp-cost-box" id="rr-cost-box" style="margin-top:14px">
          <div><div class="rp-muted">Cost to make 1 meal</div><strong id="rr-c-cost">${this.money(meal.costing?.recipe_cost)}</strong></div>
          <div><div class="rp-muted">You sell for</div><strong id="rr-c-sell">${this.money(product.selling_price)}</strong></div>
          <div><div class="rp-muted">Profit per meal</div><strong id="rr-c-profit">${this.money(meal.costing?.gross_profit)}</strong></div>
          <div><div class="rp-muted">Suggested sell (target profit)</div><strong id="rr-c-suggest">${this.money(meal.costing?.suggested_price)}</strong></div>
          <div><div class="rp-muted">Food cost %</div><strong id="rr-c-fc">${meal.costing?.food_cost_pct || 0}%</strong></div>
          <div><div class="rp-muted">Profit margin %</div><strong id="rr-c-pm">${meal.costing?.profit_margin || 0}%</strong></div>
        </div>
      </div>
      <div class="rp-toolbar">
        ${canEdit ? '<button class="btn btn-primary" id="rr-save-meal">Save recipe</button>' : '<p class="rp-muted">View only — ask Admin to grant edit access</p>'}
        <button class="btn btn-ghost" id="rr-goto-restock">Restock ingredients…</button>
        <button class="btn btn-ghost" id="rr-goto-report">View cost / profit report</button>
      </div>`;

    if (!items.length) {
      items = [{ ingredient_product_id: null, ingredient_name: '', quantity: 1, unit: 'g', waste_pct: 0, include_rule: 'always', option_name: '' }];
      cleanSnapshot = savedSnapshot();
    }

    const itemsEl = document.getElementById('rr-items');
    const resolveRowIngredient = (row) => {
      const typed = (row.querySelector('.rr-name')?.value || '').trim();
      const prevId = row.dataset.ingId ? parseInt(row.dataset.ingId, 10) : null;
      const byName = findCatalogByName(typed);
      if (byName) {
        row.dataset.ingId = String(byName.id);
        return { id: Number(byName.id), name: byName.name || typed };
      }
      if (prevId) {
        const byId = catalogById().get(prevId);
        if (byId && (!typed || typed.toLowerCase() === String(byId.name || '').toLowerCase())) {
          return { id: prevId, name: byId.name || typed };
        }
      }
      row.dataset.ingId = '';
      return { id: null, name: typed };
    };
    const syncItemsFromDom = () => {
      const next = [];
      itemsEl.querySelectorAll('.rr-row').forEach((row) => {
        const resolved = resolveRowIngredient(row);
        const rule = (row.querySelector('.rr-rule')?.value || 'always').trim();
        next.push({
          ingredient_product_id: resolved.id || null,
          ingredient_name: resolved.name,
          quantity: parseFloat(row.querySelector('.rr-qty')?.value) || 0,
          unit: (row.querySelector('.rr-unit')?.value || 'each').trim() || 'each',
          waste_pct: parseFloat(row.querySelector('.rr-waste')?.value) || 0,
          include_rule: rule,
          option_name: rule === 'always' ? '' : (row.querySelector('.rr-option')?.value || '').trim(),
          is_primary: !!(row.querySelector('.rr-primary')?.checked),
          cost_used: row.querySelector('.rr-line')?.textContent,
          current_stock: row.querySelector('.rr-stock')?.textContent
        });
      });
      // Only one main ingredient
      let sawPrimary = false;
      next.forEach(i => {
        if (i.is_primary && i.include_rule === 'always' && !sawPrimary) sawPrimary = true;
        else if (i.is_primary) i.is_primary = false;
      });
      items = next;
      setDirty(savedSnapshot() !== cleanSnapshot);
      itemsEl.querySelectorAll('.rr-row').forEach((row) => {
        const rule = (row.querySelector('.rr-rule')?.value || 'always');
        const optField = row.querySelector('.rr-option-field');
        if (optField) optField.style.display = rule === 'always' ? 'none' : '';
        const hint = row.querySelector('.rr-reuse-hint');
        if (hint) {
          const id = row.dataset.ingId ? Number(row.dataset.ingId) : null;
          const c = id ? catalogById().get(id) : null;
          const meals = (c?.used_in_meals || '').split(',').map(s => s.trim()).filter(Boolean)
            .filter(m => m.toLowerCase() !== String(product.name).toLowerCase());
          hint.textContent = c
            ? (meals.length
              ? `Reusing saved stock · also used in: ${meals.slice(0, 4).join(', ')}${meals.length > 4 ? '…' : ''}`
              : 'Reusing saved ingredient · change amount for this meal only')
            : 'New ingredient name (will be created on save)';
        }
      });
    };
    const drawItems = () => {
      itemsEl.innerHTML = items.map((it, idx) => {
        const rule = it.include_rule || 'always';
        const cat = it.ingredient_product_id ? catalogById().get(Number(it.ingredient_product_id)) : findCatalogByName(it.ingredient_name);
        const ingId = cat?.id || it.ingredient_product_id || '';
        const meals = (cat?.used_in_meals || '').split(',').map(s => s.trim()).filter(Boolean)
          .filter(m => m.toLowerCase() !== String(product.name).toLowerCase());
        const hint = cat
          ? (meals.length
            ? `Reusing saved stock · also used in: ${meals.slice(0, 4).join(', ')}${meals.length > 4 ? '…' : ''}`
            : 'Reusing saved ingredient · change amount for this meal only')
          : (it.ingredient_name ? 'New ingredient name (will be created on save)' : 'Pick from saved list or type a new name');
        return `
        <div class="form-grid rr-row" data-idx="${idx}" data-ing-id="${ingId}" style="margin-bottom:10px;align-items:end;border-bottom:1px solid var(--rp-border);padding-bottom:10px">
          <div class="field" style="flex:2"><label>Ingredient (saved or new)</label>
            <input type="text" class="rr-name" list="rr-ing-list" placeholder="Pick saved or type new…" value="${this.escapeAttr(it.ingredient_name || '')}" ${canEdit ? '' : 'readonly'}>
            <small class="rp-muted rr-reuse-hint">${this.escapeAttr(hint)}</small></div>
          <div class="field"><label>Amount for 1 meal</label><input type="number" step="0.001" min="0" class="rr-qty" value="${it.quantity > 0 ? it.quantity : 1}" ${canEdit ? '' : 'readonly'}></div>
          <div class="field"><label>Unit of measure</label>
            <input class="rr-unit" list="rr-unit-list" value="${this.escapeAttr(it.unit || cat?.recipe_unit || cat?.stock_unit || 'g')}" placeholder="g, ml, tsp…" ${canEdit ? '' : 'readonly'}></div>
          <div class="field"><label>Main (POS stock)</label>
            <label style="display:flex;align-items:center;gap:6px;margin-top:8px">
              <input type="checkbox" class="rr-primary" ${it.is_primary ? 'checked' : ''} ${canEdit && rule === 'always' ? '' : 'disabled'}>
              <span class="rp-muted">Use for available meals</span>
            </label></div>
          <div class="field"><label>Include in sale</label>
            <select class="rr-rule" ${canEdit ? '' : 'disabled'}>
              <option value="always" ${rule === 'always' ? 'selected' : ''}>Always (required)</option>
              <option value="unless_selected" ${rule === 'unless_selected' ? 'selected' : ''}>Skip if customer chooses…</option>
              <option value="when_selected" ${rule === 'when_selected' ? 'selected' : ''}>Only if customer chooses…</option>
            </select></div>
          <div class="field rr-option-field" style="${rule === 'always' ? 'display:none' : ''}"><label>POS option name</label>
            <input class="rr-option" list="rr-option-list" value="${this.escapeAttr(it.option_name || '')}" placeholder="e.g. Without Pap" ${canEdit ? '' : 'readonly'}></div>
          <div class="field"><label>Line cost</label><div class="rp-muted rr-line">${this.money(it.cost_used)}</div></div>
          <div class="field"><label>In stock</label><div class="rp-muted rr-stock">${it.current_stock ?? cat?.stock_quantity ?? '—'}</div></div>
          ${canEdit ? `<button type="button" class="btn btn-sm btn-danger rr-rm" data-idx="${idx}">Remove</button>` : ''}
        </div>`;
      }).join('');
      itemsEl.querySelectorAll('.rr-rm').forEach(b => b.onclick = () => {
        syncItemsFromDom();
        items.splice(parseInt(b.dataset.idx, 10), 1);
        if (!items.length) items.push({ ingredient_product_id: null, ingredient_name: '', quantity: 1, unit: 'g', waste_pct: 0, include_rule: 'always', option_name: '' });
        drawItems();
        setDirty(true);
        scheduleRecalc();
        refreshPicker();
      });
      itemsEl.querySelectorAll('.rr-name, .rr-qty, .rr-unit, .rr-rule, .rr-option, .rr-primary').forEach(inp => {
        inp.addEventListener('input', () => { syncItemsFromDom(); scheduleRecalc(); });
        inp.addEventListener('change', () => {
          if (inp.classList.contains('rr-primary') && inp.checked) {
            itemsEl.querySelectorAll('.rr-primary').forEach(cb => { if (cb !== inp) cb.checked = false; });
          }
          syncItemsFromDom();
          scheduleRecalc();
        });
      });
    };
    const recalc = async () => {
      syncItemsFromDom();
      targetProfit = parseFloat(document.getElementById('rr-target-profit')?.value) || 40;
      const filled = items.filter(i => i.ingredient_name && i.quantity > 0);
      if (!filled.length) return;
      const calc = await API.recipeCalcCosting(filled.map(i => ({
        ingredient_product_id: i.ingredient_product_id || undefined,
        ingredient_name: i.ingredient_name,
        quantity: i.quantity,
        unit: i.unit,
        waste_pct: i.waste_pct || 0
      })), {
        price_mode: 'profit_pct',
        target_profit_pct: targetProfit,
        override_price: product.selling_price
      }, this.user);
      if (!calc.success) return;
      const c = calc.data;
      document.getElementById('rr-c-cost').textContent = this.money(c.recipe_cost);
      document.getElementById('rr-c-fc').textContent = `${c.food_cost_pct}%`;
      document.getElementById('rr-c-sell').textContent = this.money(product.selling_price);
      document.getElementById('rr-c-profit').textContent = this.money(c.gross_profit);
      document.getElementById('rr-c-suggest').textContent = this.money(c.suggested_price);
      document.getElementById('rr-c-pm').textContent = `${c.profit_margin || 0}%`;
      // Match costing lines back by ingredient name (not filtered index)
      const byName = {};
      (c.lines || []).forEach(line => {
        if (line.ingredient_name) byName[String(line.ingredient_name).toLowerCase()] = line;
      });
      itemsEl.querySelectorAll('.rr-row').forEach((row) => {
        const name = (row.querySelector('.rr-name')?.value || '').trim().toLowerCase();
        const line = byName[name];
        if (!line) return;
        row.querySelector('.rr-line').textContent = this.money(line.cost_used);
        row.querySelector('.rr-stock').textContent = line.current_stock ?? '—';
        if (line.ingredient_product_id) row.dataset.ingId = String(line.ingredient_product_id);
      });
      syncItemsFromDom();
    };
    let recalcTimer = null;
    const scheduleRecalc = () => {
      clearTimeout(recalcTimer);
      recalcTimer = setTimeout(() => { recalc(); }, 350);
    };

    const leaveEditor = (go) => {
      syncItemsFromDom();
      if (dirty && canEdit) {
        const ok = confirm('You have unsaved recipe changes. Leave without saving?');
        if (!ok) return;
      }
      go();
    };

    const addCatalogRows = (catalogRows, { focusQty = true } = {}) => {
      if (!catalogRows?.length) return 0;
      syncItemsFromDom();
      let added = 0;
      catalogRows.forEach((c) => {
        const id = Number(c.id);
        if (!id) return;
        if (items.some(i => Number(i.ingredient_product_id) === id || String(i.ingredient_name || '').toLowerCase() === String(c.name || '').toLowerCase())) {
          return;
        }
        const row = {
          ingredient_product_id: id,
          ingredient_name: c.name,
          quantity: Number(c._qty) > 0 ? Number(c._qty) : 1,
          unit: c._unit || c.recipe_unit || c.stock_unit || c.unit || 'g',
          waste_pct: 0,
          include_rule: 'always',
          option_name: '',
          current_stock: c.stock_quantity
        };
        const blankIdx = items.findIndex(i => !i.ingredient_name && !i.ingredient_product_id);
        if (blankIdx >= 0) items[blankIdx] = row;
        else items.push(row);
        this.pushRecentIngredient(id);
        added += 1;
      });
      if (!added) {
        Utils.toast('Those ingredients are already on this meal', 'error');
        return 0;
      }
      drawItems();
      setDirty(true);
      if (focusQty) {
        const focusRow = itemsEl.querySelector('.rr-row:last-child .rr-qty');
        focusRow?.focus();
        focusRow?.select?.();
      }
      scheduleRecalc();
      refreshPicker();
      return added;
    };

    const refreshPicker = () => {
      const filterEl = document.getElementById('rr-ing-filter');
      const multi = document.getElementById('rr-pick-multi');
      const chips = document.getElementById('rr-recent-chips');
      if (!multi) return;
      const q = (filterEl?.value || '').trim().toLowerCase();
      const onMeal = new Set(items.map(i => Number(i.ingredient_product_id)).filter(Boolean));
      const visible = catalog.filter(c => {
        if (onMeal.has(Number(c.id))) return false;
        if (!q) return true;
        const hay = `${c.name || ''} ${c.used_in_meals || ''}`.toLowerCase();
        return hay.includes(q);
      }).slice(0, 200);
      multi.innerHTML = visible.map(c => {
        const also = (c.used_in_meals || '').split(',').map(s => s.trim()).filter(m => m && m.toLowerCase() !== String(product.name).toLowerCase()).slice(0, 2).join(', ');
        return `<option value="${c.id}">${this.escapeAttr(c.name)}${also ? ` — ${this.escapeAttr(also)}` : ''}</option>`;
      }).join('') || '<option disabled>(no matches)</option>';
      if (chips) {
        const recent = this.recentIngredientIds()
          .map(id => catalogById().get(id))
          .filter(c => c && !onMeal.has(Number(c.id)));
        chips.innerHTML = recent.length
          ? `<span class="rp-muted" style="width:100%">Recent:</span>${recent.map(c =>
            `<button type="button" class="btn btn-sm btn-ghost rr-recent-chip" data-id="${c.id}">+ ${this.escapeAttr(c.name)}</button>`).join('')}`
          : '';
        chips.querySelectorAll('.rr-recent-chip').forEach(btn => {
          btn.onclick = () => {
            const c = catalogById().get(Number(btn.dataset.id));
            if (c) {
              const n = addCatalogRows([c]);
              if (n) Utils.toast(`Added ${c.name}`, 'success');
            }
          };
        });
      }
    };

    drawItems();
    setDirty(false);
    refreshPicker();

    // Load meals for "copy recipe" picker
    (async () => {
      const sel = document.getElementById('rr-copy-meal');
      if (!sel) return;
      try {
        const mealsRes = await API.recipeMealProducts({ with_recipe: true, ...this.branchFilter() }, this.user);
        const meals = (mealsRes.success ? mealsRes.data : []) || [];
        sel.innerHTML = `<option value="">Choose a meal with a recipe…</option>` +
          meals.filter(m => Number(m.id) !== Number(productId))
            .map(m => `<option value="${m.id}">${this.escapeAttr(m.name)} (${m.ingredient_count || '?'})</option>`).join('');
      } catch (_) { /* ignore */ }
    })();

    document.getElementById('rp-back-meals').onclick = () => leaveEditor(() => {
      this._editingMealProductId = null;
      this.pageRecipes(el);
    });
    document.getElementById('rr-add-item')?.addEventListener('click', () => {
      syncItemsFromDom();
      items.push({ ingredient_product_id: null, ingredient_name: '', quantity: 1, unit: 'g', waste_pct: 0, include_rule: 'always', option_name: '' });
      drawItems();
      setDirty(true);
      const last = itemsEl.querySelector('.rr-row:last-child .rr-name');
      last?.focus();
    });
    document.getElementById('rr-ing-filter')?.addEventListener('input', () => refreshPicker());
    document.getElementById('rr-pick-all-vis')?.addEventListener('click', () => {
      const multi = document.getElementById('rr-pick-multi');
      if (!multi) return;
      [...multi.options].forEach(o => { if (!o.disabled) o.selected = true; });
    });
    document.getElementById('rr-pick-clear')?.addEventListener('click', () => {
      const multi = document.getElementById('rr-pick-multi');
      if (!multi) return;
      [...multi.options].forEach(o => { o.selected = false; });
    });
    document.getElementById('rr-add-selected')?.addEventListener('click', () => {
      const multi = document.getElementById('rr-pick-multi');
      const ids = [...(multi?.selectedOptions || [])].map(o => Number(o.value)).filter(Boolean);
      if (!ids.length) return Utils.toast('Select one or more ingredients first', 'error');
      const rows = ids.map(id => catalogById().get(id)).filter(Boolean);
      const n = addCatalogRows(rows);
      if (n) Utils.toast(`Added ${n} ingredient(s) — set amounts for 1 ${product.name}`, 'success');
    });
    document.getElementById('rr-copy-apply')?.addEventListener('click', async () => {
      const id = parseInt(document.getElementById('rr-copy-meal')?.value, 10);
      if (!id) return Utils.toast('Choose a meal to copy from', 'error');
      const res = await API.recipeGetMeal(id, this.user);
      if (!res.success) return Utils.toast(res.error || 'Could not load meal', 'error');
      const srcItems = res.data?.items || [];
      if (!srcItems.length) return Utils.toast('That meal has no ingredients', 'error');
      syncItemsFromDom();
      let added = 0;
      srcItems.forEach((si) => {
        const name = si.ingredient_name || '';
        const pid = si.ingredient_product_id || findCatalogByName(name)?.id || null;
        if (!name && !pid) return;
        if (items.some(i => (pid && Number(i.ingredient_product_id) === Number(pid)) ||
          String(i.ingredient_name || '').toLowerCase() === String(name).toLowerCase())) return;
        const blankIdx = items.findIndex(i => !i.ingredient_name && !i.ingredient_product_id);
        const row = {
          ingredient_product_id: pid ? Number(pid) : null,
          ingredient_name: name,
          quantity: Number(si.quantity) > 0 ? Number(si.quantity) : 1,
          unit: si.unit || 'g',
          waste_pct: si.waste_pct || 0,
          include_rule: si.include_rule || 'always',
          option_name: si.option_name || '',
          is_primary: !!Number(si.is_primary),
          current_stock: si.current_stock
        };
        if (blankIdx >= 0) items[blankIdx] = row;
        else items.push(row);
        if (pid) this.pushRecentIngredient(pid);
        added += 1;
      });
      if (!added) return Utils.toast('All those ingredients are already on this meal', 'error');
      drawItems();
      setDirty(true);
      refreshPicker();
      scheduleRecalc();
      Utils.toast(`Copied ${added} ingredient(s) — review amounts then Save`, 'success');
    });
    document.getElementById('rr-bulk-toggle')?.addEventListener('click', () => {
      const box = document.getElementById('rr-bulk-box');
      if (!box) return;
      box.style.display = box.style.display === 'none' ? '' : 'none';
    });
    document.getElementById('rr-bulk-apply')?.addEventListener('click', () => {
      const text = document.getElementById('rr-bulk-text')?.value || '';
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) return Utils.toast('Paste at least one line', 'error');
      const parsed = [];
      lines.forEach((line) => {
        const parts = line.split(/[,;\t]+/).map(s => s.trim()).filter(Boolean);
        if (!parts.length) return;
        const name = parts[0];
        let qty = 1;
        let unit = 'g';
        if (parts.length >= 2 && !Number.isNaN(parseFloat(parts[1]))) {
          qty = parseFloat(parts[1]) || 1;
          unit = parts[2] || 'g';
        } else if (parts.length >= 2) {
          const m = parts[1].match(/^([\d.]+)\s*(.*)$/);
          if (m) { qty = parseFloat(m[1]) || 1; unit = m[2] || parts[2] || 'g'; }
          else unit = parts[1];
        }
        const cat = findCatalogByName(name);
        if (cat) parsed.push({ ...cat, _qty: qty, _unit: unit || cat.recipe_unit || cat.stock_unit || 'g' });
        else {
          syncItemsFromDom();
          if (!items.some(i => String(i.ingredient_name || '').toLowerCase() === name.toLowerCase())) {
            const blankIdx = items.findIndex(i => !i.ingredient_name && !i.ingredient_product_id);
            const row = {
              ingredient_product_id: null,
              ingredient_name: name,
              quantity: qty,
              unit: unit || 'g',
              waste_pct: 0,
              include_rule: 'always',
              option_name: ''
            };
            if (blankIdx >= 0) items[blankIdx] = row;
            else items.push(row);
          }
        }
      });
      const n = addCatalogRows(parsed, { focusQty: false });
      drawItems();
      setDirty(true);
      refreshPicker();
      scheduleRecalc();
      Utils.toast(`Added from paste${n ? ` (${n} saved + new names)` : ''}`, 'success');
      const box = document.getElementById('rr-bulk-box');
      if (box) box.style.display = 'none';
    });
    document.getElementById('rr-target-profit')?.addEventListener('change', () => { setDirty(true); scheduleRecalc(); });
    document.getElementById('rr-kitchen')?.addEventListener('input', () => setDirty(true));
    document.getElementById('rr-allergens')?.addEventListener('input', () => setDirty(true));
    document.getElementById('rr-instructions')?.addEventListener('input', () => setDirty(true));
    let baseQtys = items.map(i => Number(i.quantity) || 0);
    document.getElementById('rr-scale-apply')?.addEventListener('click', () => {
      syncItemsFromDom();
      const n = Math.max(1, parseInt(document.getElementById('rr-scale')?.value, 10) || 1);
      if (baseQtys.length !== items.length) baseQtys = items.map(i => Number(i.quantity) || 0);
      items = items.map((it, idx) => ({ ...it, quantity: Math.round((baseQtys[idx] || it.quantity) * n * 1000) / 1000 }));
      drawItems();
      Utils.toast(`Showing amounts for ${n} portion(s) — Save still stores per 1 meal (divide by ${n} before save or reset)`, 'success');
    });
    document.getElementById('rr-scale-reset')?.addEventListener('click', () => {
      syncItemsFromDom();
      const n = Math.max(1, parseInt(document.getElementById('rr-scale')?.value, 10) || 1);
      items = items.map((it, idx) => ({
        ...it,
        quantity: Math.round(((Number(it.quantity) || 0) / n) * 1000) / 1000
      }));
      document.getElementById('rr-scale').value = '1';
      baseQtys = items.map(i => Number(i.quantity) || 0);
      drawItems();
      setDirty(true);
      scheduleRecalc();
    });
    document.getElementById('rr-goto-restock').onclick = () => leaveEditor(() => {
      this._editingMealProductId = null;
      this.page = 'restock';
      this.render();
    });
    document.getElementById('rr-goto-ing-master')?.addEventListener('click', () => leaveEditor(() => {
      this._editingMealProductId = null;
      this.page = 'ingredients';
      this.render();
    }));
    document.getElementById('rr-goto-report').onclick = () => leaveEditor(() => {
      this._editingMealProductId = null;
      this.page = 'reports';
      this._preferMealProfitReport = true;
      this.render();
    });
    document.getElementById('rr-save-meal')?.addEventListener('click', async () => {
      if (saving) return;
      syncItemsFromDom();
      const lines = items.filter(i => (i.ingredient_name || i.ingredient_product_id) && Number(i.quantity) > 0);
      if (!lines.length) return Utils.toast('Pick or type at least one ingredient and amount', 'error');
      for (const i of lines) {
        if ((i.include_rule || 'always') !== 'always' && !(i.option_name || '').trim()) {
          return Utils.toast(`Set POS option name for optional ingredient "${i.ingredient_name}" (e.g. Without Pap)`, 'error');
        }
      }
      saving = true;
      setDirty(dirty);
      // Always persist per 1 meal — if scale preview > 1, divide amounts back
      const scaleN = Math.max(1, parseInt(document.getElementById('rr-scale')?.value, 10) || 1);
      const payload = {
        ...this.branchFilter(),
        product_id: productId,
        production_mode: document.getElementById('rr-prod-mode')?.value || 'make_to_order',
        target_profit_pct: parseFloat(document.getElementById('rr-target-profit')?.value) || 40,
        kitchen_notes: document.getElementById('rr-kitchen')?.value || '',
        allergens: document.getElementById('rr-allergens')?.value || '',
        instructions: document.getElementById('rr-instructions')?.value || '',
        description: document.getElementById('rr-instructions')?.value || product.description || '',
        items: lines.map(i => ({
          ingredient_name: i.ingredient_name,
          ingredient_product_id: i.ingredient_product_id || undefined,
          quantity: Math.round((Number(i.quantity) / scaleN) * 1000) / 1000,
          unit: i.unit || 'each',
          waste_pct: i.waste_pct || 0,
          include_rule: i.include_rule || 'always',
          option_name: i.option_name || null,
          is_primary: !!i.is_primary
        }))
      };
      try {
        const saved = await API.recipeSaveMeal(payload, this.user);
        if (!saved.success) {
          saving = false;
          setDirty(true);
          return Utils.toast(saved.error || 'Save failed', 'error');
        }
        const count = saved.data?.saved_count || saved.data?.items?.length || lines.length;
        const names = (saved.data?.saved_items || saved.data?.items || [])
          .map(i => `${i.ingredient_name} ${i.quantity} ${i.unit}`).join(' · ');
        Utils.toast(`Saved ${count} ingredient(s) for ${product.name}`, 'success');
        this._ingredients = [];
        this._editingMealProductId = productId;
        // Reload from database so re-edit shows exactly what was saved
        await this.renderMealRecipeEditor(el, productId);
        if (names) {
          const sum = document.getElementById('rr-saved-summary');
          if (sum) sum.innerHTML = `Currently saved: <strong>${count}</strong> ingredient(s) — ${names}`;
        }
      } catch (err) {
        saving = false;
        setDirty(true);
        Utils.toast(err.message || 'Save failed', 'error');
      }
    });
    scheduleRecalc();
  },

  async pageRestock(el) {
    // Fresh from DB every time — picks up recipe saves / re-edits immediately
    this._ingredients = [];
    const listRes = await API.recipeRestockList(this.user);
    if (!listRes.success) throw new Error(listRes.error || 'Failed to load restock list');
    const all = listRes.data || [];
    const onRecipe = all.filter(p => p.from_recipe);
    const other = all.filter(p => !p.from_recipe);
    // Show recipe ingredients first (the ones from saved/re-edited meals)
    const ingredients = [...onRecipe, ...other];
    this._ingredients = ingredients;
    const can = RecipePerms.can(this.user, 'produce');
    el.innerHTML = `
      <div class="rp-restock">
      <p class="rp-muted" style="margin-top:0">
        Restock once per <strong>shared ingredient</strong>. Enter target meals and tap <strong>Calculate for me</strong>
        — the system fills buy quantities from every recipe (main ingredient drives POS stock).
      </p>
      <div class="rp-toolbar rp-restock-toolbar">
        <label class="rp-muted">Target meals</label>
        <input type="number" id="rp-rs-target" min="1" step="1" value="20" style="width:80px">
        ${can ? '<button class="btn btn-primary" id="rp-rs-calc">Calculate for me</button>' : ''}
        <button class="btn btn-ghost" id="rp-rs-refresh">Refresh</button>
        ${can ? '<button class="btn btn-ghost" id="rp-rs-po">Create Purchase Order from filled lines</button>' : ''}
        <button class="btn btn-ghost" id="rp-rs-po-page">PO history…</button>
        <span class="rp-tag ok">${onRecipe.length} on recipes</span>
        ${other.length ? `<span class="rp-tag">${other.length} not on a meal</span>` : ''}
        ${this.docActionsHtml('rp-rs')}
      </div>
      <div class="rp-panel rp-restock-hist">
        <h3>Stock usage history</h3>
        <div class="rp-toolbar">
          <label class="rp-muted">From</label><input type="date" id="rp-rs-hist-from" value="${this._rsHistFrom || new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA')}">
          <label class="rp-muted">To</label><input type="date" id="rp-rs-hist-to" value="${this._rsHistTo || new Date().toLocaleDateString('en-CA')}">
          <button class="btn btn-ghost btn-sm" id="rp-rs-hist-run">Filter usage</button>
        </div>
        <div id="rp-rs-hist"><p class="rp-muted">Apply a date filter to see stock used / added per ingredient.</p></div>
      </div>
      <div class="rp-panel rp-restock-lines">
        <div class="rp-restock-lines-head">
          <h3>Restock by line</h3>
          <p class="rp-muted">Stock left is shown per ingredient. Also try: Calculate for me, Create PO, low-stock filter on Ingredients, Profits &amp; Losses tab.</p>
        </div>
        ${!ingredients.length
          ? '<p class="rp-muted">No ingredients yet. Add them in Ingredient Master or Recipe Builder, then restock here.</p>'
          : `<div class="rp-restock-table-wrap"><table class="rp-table rp-restock-table"><thead><tr>
              <th>Ingredient</th><th>Used in meals</th><th>Now in stock</th><th>Qty bought</th><th>Buy unit</th><th>Total cost paid</th><th></th>
            </tr></thead>
            <tbody>${ingredients.map(p => {
              const stockU = p.stock_unit || p.unit || 'each';
              const buyU = p.restock_unit || p.purchase_unit || stockU;
              const recipeU = p.recipe_unit && p.recipe_unit !== stockU ? p.recipe_unit : null;
              return `<tr data-id="${p.id}">
              <td><strong>${p.name}</strong>
                ${p.from_recipe ? '' : '<div class="rp-muted" style="font-size:11px">Not on a current recipe</div>'}
                ${recipeU ? `<div class="rp-muted" style="font-size:11px">Recipe uses: ${recipeU}</div>` : ''}
              </td>
              <td class="rp-muted rp-restock-meals">${p.used_in_meals || '—'}</td>
              <td><strong>${p.stock_quantity}</strong> <span class="rp-muted">${stockU}</span></td>
              <td><input type="number" step="0.001" class="rp-rs-qty" style="width:90px" placeholder="0"></td>
              <td><input class="rp-rs-unit" list="rp-rs-units" style="width:80px" value="${this.escapeAttr(buyU)}" title="Unit you bought in (converted to ${stockU} in stock)"></td>
              <td><input type="number" step="0.01" class="rp-rs-cost" style="width:100px" placeholder="0.00"></td>
              <td>${can ? `<button type="button" class="btn btn-sm btn-primary rp-rs-one">Add stock</button>` : ''}</td>
            </tr>`;
            }).join('')}</tbody></table></div>
            <datalist id="rp-rs-units"><option value="g"><option value="kg"><option value="ml"><option value="L"><option value="litre"><option value="each"><option value="piece"></datalist>
            <div class="rp-restock-footer">
              ${can ? '<button class="btn btn-primary" id="rp-rs-all">Save all filled lines</button>' : ''}
              <p class="rp-muted">Buy unit is converted into the stock unit shown (e.g. 1 kg → 1000 g). Use the same unit you pay for.</p>
            </div>`}
      </div>
      </div>`;

    this.bindDocActions('rp-rs', () => ({
      title: 'Restock Ingredients — current stock',
      filename: `restock-stock-${Date.now()}.pdf`,
      rows: (ingredients || []).map(p => ({
        name: p.name,
        used_in: p.used_in_meals || '',
        stock: p.stock_quantity,
        unit: p.stock_unit || p.unit || '',
        avg_cost: p.buying_price
      })),
      keys: ['name', 'used_in', 'stock', 'unit', 'avg_cost']
    }));

    document.getElementById('rp-rs-refresh')?.addEventListener('click', () => {
      this._ingredients = [];
      this.pageRestock(el);
    });
    document.getElementById('rp-rs-po-page')?.addEventListener('click', () => {
      this.page = 'purchase-orders';
      this.render();
    });
    document.getElementById('rp-rs-hist-run')?.addEventListener('click', async () => {
      this._rsHistFrom = document.getElementById('rp-rs-hist-from').value;
      this._rsHistTo = document.getElementById('rp-rs-hist-to').value;
      const res = await API.recipeIngredientStockHistory({
        from: this._rsHistFrom, to: this._rsHistTo
      }, this.user);
      const box = document.getElementById('rp-rs-hist');
      if (!res.success) {
        box.innerHTML = `<p class="error-msg">${res.error || 'Failed'}</p>`;
        return;
      }
      const summary = res.data?.summary || [];
      const moves = (res.data?.movements || []).slice(0, 40);
      box.innerHTML = `
        <table class="rp-table"><thead><tr><th>Ingredient</th><th>Stock left</th><th>Used</th><th>Added</th><th>Moves</th></tr></thead>
        <tbody>${summary.map(s => `<tr>
          <td>${s.product_name}</td><td><strong>${s.stock_left}</strong> ${s.unit || ''}</td>
          <td>${s.qty_used}</td><td>${s.qty_added}</td><td>${s.movements}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No movements in range</td></tr>'}</tbody></table>
        <h4 style="margin-top:12px">Recent movements</h4>
        <table class="rp-table"><thead><tr><th>When</th><th>Ingredient</th><th>Type</th><th>Qty</th><th>Notes</th></tr></thead>
        <tbody>${moves.map(m => `<tr>
          <td>${m.created_at}</td><td>${m.product_name}</td><td>${m.movement_type}</td>
          <td>${m.quantity}</td><td class="rp-muted">${m.notes || '—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">—</td></tr>'}</tbody></table>`;
    });
    document.getElementById('rp-rs-calc')?.addEventListener('click', async () => {
      const target = parseInt(document.getElementById('rp-rs-target')?.value, 10) || 20;
      const res = await API.recipeRestockPlan(target, this.user);
      if (!res.success) return Utils.toast(res.error || 'Calculate failed', 'error');
      const byId = new Map((res.data?.lines || []).map(l => [Number(l.id), l]));
      let filled = 0;
      el.querySelectorAll('tbody tr').forEach(tr => {
        const line = byId.get(Number(tr.dataset.id));
        if (!line) return;
        const qtyEl = tr.querySelector('.rp-rs-qty');
        const unitEl = tr.querySelector('.rp-rs-unit');
        const costEl = tr.querySelector('.rp-rs-cost');
        if (qtyEl) qtyEl.value = line.buy_qty > 0 ? line.buy_qty : '';
        if (unitEl && line.unit) unitEl.value = line.unit;
        if (costEl && line.est_cost > 0) costEl.value = line.est_cost;
        if (line.buy_qty > 0) filled++;
      });
      Utils.toast(filled
        ? `Filled ${filled} line(s) to support ~${target} meals — review & Save`
        : `Stock already covers ~${target} meals`, 'success');
    });
    document.getElementById('rp-rs-po')?.addEventListener('click', async () => {
      const items = [];
      el.querySelectorAll('.rp-rs-qty').forEach(inp => {
        const tr = inp.closest('tr');
        const qty = parseFloat(inp.value) || 0;
        if (!(qty > 0) || !tr?.dataset?.id) return;
        const totalCost = parseFloat(tr.querySelector('.rp-rs-cost')?.value) || 0;
        items.push({
          product_id: parseInt(tr.dataset.id, 10),
          quantity: qty,
          buying_price: totalCost > 0 ? totalCost / qty : null
        });
      });
      if (!items.length) return Utils.toast('Fill Qty bought on lines first', 'error');
      const res = await API.recipeCreateRestockPo({ items, notes: 'From Recipe Restock' }, this.user);
      if (!res.success) return Utils.toast(res.error || 'PO failed', 'error');
      Utils.toast(`Draft PO ${res.data?.po_number || ''} created`, 'success');
      this.page = 'purchase-orders';
      this.render();
    });

    const saveRow = async (tr) => {
      const qty = parseFloat(tr.querySelector('.rp-rs-qty').value) || 0;
      if (!(qty > 0)) return { skipped: true };
      const res = await API.recipeRestockIngredient({
        product_id: parseInt(tr.dataset.id, 10),
        quantity: qty,
        unit: tr.querySelector('.rp-rs-unit').value.trim() || 'each',
        total_cost: tr.querySelector('.rp-rs-cost').value || null
      }, this.user);
      return res;
    };

    el.querySelectorAll('.rp-rs-one').forEach(btn => {
      btn.onclick = async () => {
        const tr = btn.closest('tr');
        const res = await saveRow(tr);
        if (res.skipped) return Utils.toast('Enter quantity bought', 'error');
        if (!res.success) return Utils.toast(res.error, 'error');
        Utils.toast('Stock updated', 'success');
        this._ingredients = [];
        this.pageRestock(el);
      };
    });
    document.getElementById('rp-rs-all')?.addEventListener('click', async () => {
      let n = 0;
      for (const tr of el.querySelectorAll('tbody tr')) {
        const res = await saveRow(tr);
        if (res.skipped) continue;
        if (!res.success) return Utils.toast(res.error, 'error');
        n++;
      }
      if (!n) return Utils.toast('Fill quantity on at least one line', 'error');
      Utils.toast(`Updated ${n} ingredient(s)`, 'success');
      this._ingredients = [];
      this.pageRestock(el);
    });
  },

  recipeRows(list) {
    return list.map(r => `<tr>
      <td><strong>${r.name}</strong> <span class="rp-muted">v${r.version}</span></td>
      <td>${r.category || '—'}</td>
      <td>${this.money(r.recipe_cost)}</td>
      <td>${this.money(r.selling_price)}</td>
      <td>${r.profit_margin || 0}%</td>
      <td>${r.production_mode || 'make_to_order'}</td>
      <td>${this.statusTag(r.status)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost rp-edit-r" data-id="${r.id}">Open</button>
        ${r.status === 'approved' && RecipePerms.can(this.user, 'approve') ? `<button class="btn btn-sm btn-success rp-make-prod" data-id="${r.id}">Create Product</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="8" class="rp-muted">No recipes yet</td></tr>';
  },

  bindRecipeRowActions(el) {
    el.querySelectorAll('.rp-edit-r').forEach(b => b.addEventListener('click', async () => {
      const res = await API.recipeGet(parseInt(b.dataset.id, 10), this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      this._editingRecipe = res.data;
      this._useLegacyEditor = true;
      this._editingMealProductId = null;
      this.renderRecipeEditor(el, res.data);
    }));
    el.querySelectorAll('.rp-make-prod').forEach(b => b.addEventListener('click', async () => {
      const barcode = prompt('Barcode (optional):') || '';
      const sku = prompt('SKU (optional):') || '';
      const res = await API.recipeCreateProduct(parseInt(b.dataset.id, 10), {
        new_arrival_days: 14,
        barcode: barcode || null,
        sku: sku || null
      }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Product created in POS under New Arrival', 'success');
      this.pageRecipes(el);
    }));
  },

  async renderRecipeEditor(el, recipe) {
    if (!this._ingredients.length) {
      const ing = await API.recipeIngredients({}, this.user);
      this._ingredients = ing.data || [];
    }
    const r = recipe || {};
    const items = (r.items || []).map(i => ({ ...i }));
    if (!items.length) items.push({ ingredient_product_id: '', quantity: 1, unit: 'each', waste_pct: 0 });
    const canEdit = !r.id || RecipePerms.can(this.user, 'edit') || RecipePerms.can(this.user, 'create');
    const canPrice = RecipePerms.can(this.user, 'prices') || RecipePerms.can(this.user, 'costing');

    const ingOptions = (selected) => this._ingredients.map(p =>
      `<option value="${p.id}" ${String(p.id) === String(selected) ? 'selected' : ''}>${p.name} (${p.stock_quantity} ${p.stock_unit || p.unit})</option>`
    ).join('');

    el.innerHTML = `
      <div class="rp-toolbar">
        <button class="btn btn-ghost" id="rp-back-list">← Back to list</button>
        ${r.id ? this.statusTag(r.status) : '<span class="rp-tag">new</span>'}
      </div>
      <div class="rp-grid-2">
        <div class="rp-panel">
          <h3>Recipe Details</h3>
          <div class="form-grid">
            <div class="field full"><label>Name *</label><input id="rr-name" value="${r.name || ''}" ${canEdit ? '' : 'disabled'}></div>
            <div class="field"><label>Category</label><input id="rr-cat" value="${r.category || ''}" ${canEdit ? '' : 'disabled'}></div>
            <div class="field"><label>Production Mode</label>
              <select id="rr-mode" ${canEdit ? '' : 'disabled'}>
                <option value="make_to_order" ${r.production_mode !== 'make_to_stock' ? 'selected' : ''}>Make to Order (deduct on POS sale)</option>
                <option value="make_to_stock" ${r.production_mode === 'make_to_stock' ? 'selected' : ''}>Make to Stock (produce first)</option>
              </select>
            </div>
            <div class="field"><label>Prep (min)</label><input type="number" id="rr-prep" value="${r.prep_time_minutes || 0}"></div>
            <div class="field"><label>Cook (min)</label><input type="number" id="rr-cook" value="${r.cook_time_minutes || 0}"></div>
            <div class="field"><label>Servings / Yield</label><input type="number" id="rr-yield" step="0.01" value="${r.yield_qty || 1}"></div>
            <div class="field"><label>New Arrival Days</label><select id="rr-arrival">
              ${[7, 14, 30].map(d => `<option value="${d}" ${(r.new_arrival_days || 14) == d ? 'selected' : ''}>${d} days</option>`).join('')}
            </select></div>
            <div class="field full"><label>Description</label><input id="rr-desc" value="${r.description || ''}"></div>
            <div class="field full"><label>Instructions</label><textarea id="rr-instr" rows="4">${r.instructions || ''}</textarea></div>
            <div class="field full"><label>Notes</label><input id="rr-notes" value="${r.notes || ''}"></div>
            <div class="field full"><label>Video URL (optional)</label><input id="rr-video" value="${r.video_url || ''}"></div>
            <div class="field full"><label><input type="checkbox" id="rr-today" ${r.available_today ? 'checked' : ''}> Available Today</label></div>
          </div>
        </div>
        <div class="rp-panel">
          <h3>Costing & Profit</h3>
          <div class="form-grid">
            <div class="field"><label>Price Mode</label>
              <select id="rr-pmode" ${canPrice ? '' : 'disabled'}>
                <option value="profit_pct" ${r.price_mode === 'profit_pct' || !r.price_mode ? 'selected' : ''}>Desired Profit %</option>
                <option value="markup_pct" ${r.price_mode === 'markup_pct' ? 'selected' : ''}>Markup %</option>
                <option value="gross_margin" ${r.price_mode === 'gross_margin' ? 'selected' : ''}>Gross Margin %</option>
                <option value="manual" ${r.price_mode === 'manual' ? 'selected' : ''}>Manual Override</option>
              </select>
            </div>
            <div class="field"><label>Target %</label><input type="number" id="rr-tpct" value="${r.target_profit_pct ?? 40}" ${canPrice ? '' : 'disabled'}></div>
            <div class="field"><label>Override Sell Price</label><input type="number" step="0.01" id="rr-override" value="${r.override_price ?? ''}" ${canPrice ? '' : 'disabled'}></div>
          </div>
          <div class="rp-cost-box" id="rr-cost-box" style="margin-top:12px">
            <div><div class="rp-muted">Recipe Cost</div><strong id="rr-c-cost">${this.money(r.recipe_cost)}</strong></div>
            <div><div class="rp-muted">Suggested</div><strong id="rr-c-sug">${this.money(r.suggested_price)}</strong></div>
            <div><div class="rp-muted">Selling</div><strong id="rr-c-sell">${this.money(r.selling_price)}</strong></div>
            <div><div class="rp-muted">Profit</div><strong id="rr-c-profit">${this.money(r.gross_profit)}</strong></div>
            <div><div class="rp-muted">Food Cost %</div><strong id="rr-c-fc">${r.food_cost_pct || 0}%</strong></div>
            <div><div class="rp-muted">Margin %</div><strong id="rr-c-m">${r.profit_margin || 0}%</strong></div>
          </div>
          ${(r.versions || []).length ? `<h4 style="margin-top:16px">Version History</h4>
            <table class="rp-table"><thead><tr><th>Ver</th><th>Cost</th><th>Δ Cost</th><th>Sell</th><th>Δ Price</th><th>When</th><th>Notes</th></tr></thead>
            <tbody>${r.versions.map(v => `<tr>
              <td>v${v.version}</td>
              <td>${this.money(v.recipe_cost)}</td>
              <td>${v.cost_diff ? (v.cost_diff > 0 ? '+' : '') + this.money(v.cost_diff) : '—'}</td>
              <td>${this.money(v.selling_price)}</td>
              <td>${v.price_diff ? (v.price_diff > 0 ? '+' : '') + this.money(v.price_diff) : '—'}</td>
              <td>${v.created_at || '—'}</td>
              <td>${v.change_notes || '—'}</td>
            </tr>`).join('')}</tbody></table>` : ''}
        </div>
      </div>
      <div class="rp-panel">
        <h3>Ingredients</h3>
        <div id="rr-items"></div>
        ${canEdit ? '<button type="button" class="btn btn-ghost btn-sm" id="rr-add-item">+ Add Ingredient</button>' : ''}
      </div>
      <div class="rp-toolbar">
        ${canEdit ? '<button class="btn btn-primary" id="rr-save">Save Draft</button>' : ''}
        ${canEdit && (!r.status || r.status === 'draft' || r.status === 'rejected') ? '<button class="btn btn-warning" id="rr-submit">Submit for Approval</button>' : ''}
        ${RecipePerms.can(this.user, 'approve') && r.status === 'pending' ? '<button class="btn btn-success" id="rr-approve">Approve</button><button class="btn btn-danger" id="rr-reject">Reject</button>' : ''}
        ${RecipePerms.can(this.user, 'approve') && r.status === 'approved' ? '<button class="btn btn-success" id="rr-create-pos">Create Product in POS</button>' : ''}
        ${RecipePerms.can(this.user, 'delete') && r.id ? '<button class="btn btn-ghost" id="rr-archive">Archive</button>' : ''}
        ${RecipePerms.can(this.user, 'delete') && r.id && r.status !== 'approved' ? '<button class="btn btn-danger" id="rr-delete">Delete</button>' : ''}
      </div>`;

    const itemsEl = document.getElementById('rr-items');
    const drawItems = () => {
      itemsEl.innerHTML = items.map((it, idx) => `
        <div class="form-grid rr-row" data-idx="${idx}" style="margin-bottom:8px;align-items:end">
          <div class="field" style="flex:2"><label>Ingredient</label>
            <select class="rr-ing">${ingOptions(it.ingredient_product_id)}</select></div>
          <div class="field"><label>Qty</label><input type="number" step="0.001" class="rr-qty" value="${it.quantity || 1}"></div>
          <div class="field"><label>Unit</label><input class="rr-unit" value="${it.unit || 'each'}"></div>
          <div class="field"><label>Waste %</label><input type="number" step="0.1" class="rr-waste" value="${it.waste_pct || 0}"></div>
          <div class="field"><label>Stock</label><div class="rp-muted rr-stock">${it.current_stock ?? '—'}</div></div>
          <div class="field"><label>Unit Cost</label><div class="rp-muted rr-ucost">${this.money(it.unit_cost)}</div></div>
          <div class="field"><label>Cost Used</label><div class="rp-muted rr-line">${this.money(it.cost_used)}</div></div>
          <div class="field"><label>Supplier</label><div class="rp-muted rr-sup">${it.supplier_name || '—'}</div></div>
          <div class="field"><label>Available</label><div class="rp-muted rr-avail">${it.available === false ? '<span class="rp-tag danger">No</span>' : '<span class="rp-tag ok">Yes</span>'}</div></div>
          ${canEdit ? `<button type="button" class="btn btn-sm btn-danger rr-rm" data-idx="${idx}">✕</button>` : ''}
        </div>`).join('');
      itemsEl.querySelectorAll('.rr-rm').forEach(b => b.onclick = () => {
        items.splice(parseInt(b.dataset.idx, 10), 1);
        drawItems();
        recalc();
      });
      itemsEl.querySelectorAll('.rr-ing, .rr-qty, .rr-unit, .rr-waste').forEach(inp => {
        inp.onchange = () => { syncItemsFromDom(); recalc(); };
        inp.oninput = () => { syncItemsFromDom(); };
      });
    };

    const syncItemsFromDom = () => {
      itemsEl.querySelectorAll('.rr-row').forEach((row, idx) => {
        items[idx] = {
          ingredient_product_id: parseInt(row.querySelector('.rr-ing').value, 10) || null,
          quantity: parseFloat(row.querySelector('.rr-qty').value) || 0,
          unit: row.querySelector('.rr-unit').value || 'each',
          waste_pct: parseFloat(row.querySelector('.rr-waste').value) || 0
        };
      });
    };

    const recalc = async () => {
      syncItemsFromDom();
      const opts = {
        price_mode: document.getElementById('rr-pmode').value,
        target_profit_pct: parseFloat(document.getElementById('rr-tpct').value) || 40,
        override_price: document.getElementById('rr-override').value
      };
      const res = await API.recipeCalcCosting(items.filter(i => i.ingredient_product_id), opts, this.user);
      if (!res.success) return;
      const c = res.data;
      document.getElementById('rr-c-cost').textContent = this.money(c.recipe_cost);
      document.getElementById('rr-c-sug').textContent = this.money(c.suggested_price);
      document.getElementById('rr-c-sell').textContent = this.money(c.selling_price);
      document.getElementById('rr-c-profit').textContent = this.money(c.gross_profit);
      document.getElementById('rr-c-fc').textContent = `${c.food_cost_pct}%`;
      document.getElementById('rr-c-m').textContent = `${c.profit_margin}%`;
      (c.lines || []).forEach((line, i) => {
        const row = itemsEl.querySelectorAll('.rr-row')[i];
        if (!row) return;
        const cell = row.querySelector('.rr-line');
        if (cell) cell.textContent = this.money(line.cost_used);
        const st = row.querySelector('.rr-stock');
        if (st) st.textContent = line.current_stock ?? '—';
        const uc = row.querySelector('.rr-ucost');
        if (uc) uc.textContent = this.money(line.unit_cost);
        const sp = row.querySelector('.rr-sup');
        if (sp) sp.textContent = line.supplier_name || '—';
        const av = row.querySelector('.rr-avail');
        if (av) av.innerHTML = line.available === false ? '<span class="rp-tag danger">No</span>' : '<span class="rp-tag ok">Yes</span>';
      });
    };

    drawItems();
    document.getElementById('rr-add-item')?.addEventListener('click', () => {
      items.push({ ingredient_product_id: this._ingredients[0]?.id || '', quantity: 1, unit: 'each', waste_pct: 0 });
      drawItems();
      recalc();
    });
    ['rr-pmode', 'rr-tpct', 'rr-override'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', recalc);
    });
    document.getElementById('rp-back-list').onclick = () => {
      this._editingRecipe = null;
      this.pageRecipes(el);
    };

    const collect = () => {
      syncItemsFromDom();
      return {
        id: r.id,
        name: document.getElementById('rr-name').value.trim(),
        category: document.getElementById('rr-cat').value.trim(),
        production_mode: document.getElementById('rr-mode').value,
        prep_time_minutes: parseInt(document.getElementById('rr-prep').value, 10) || 0,
        cook_time_minutes: parseInt(document.getElementById('rr-cook').value, 10) || 0,
        yield_qty: parseFloat(document.getElementById('rr-yield').value) || 1,
        new_arrival_days: parseInt(document.getElementById('rr-arrival').value, 10) || 14,
        description: document.getElementById('rr-desc').value.trim(),
        instructions: document.getElementById('rr-instr').value,
        notes: document.getElementById('rr-notes').value.trim(),
        video_url: document.getElementById('rr-video').value.trim(),
        available_today: document.getElementById('rr-today').checked,
        price_mode: document.getElementById('rr-pmode').value,
        target_profit_pct: parseFloat(document.getElementById('rr-tpct').value) || 40,
        override_price: document.getElementById('rr-override').value || null,
        items: items.filter(i => i.ingredient_product_id),
        product_id: r.product_id || null,
        image_path: r.image_path || null
      };
    };

    document.getElementById('rr-save')?.addEventListener('click', async () => {
      const data = collect();
      if (!data.name) return Utils.toast('Name required', 'error');
      const res = await API.recipeSave(data, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Recipe saved', 'success');
      this._editingRecipe = res.data;
      this.renderRecipeEditor(el, res.data);
    });
    document.getElementById('rr-submit')?.addEventListener('click', async () => {
      let id = r.id;
      if (!id || canEdit) {
        const saved = await API.recipeSave(collect(), this.user);
        if (!saved.success) return Utils.toast(saved.error, 'error');
        id = saved.data.id;
      }
      const res = await API.recipeSubmit(id, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Submitted for approval', 'success');
      this._editingRecipe = res.data;
      this.renderRecipeEditor(el, res.data);
    });
    document.getElementById('rr-approve')?.addEventListener('click', async () => {
      const res = await API.recipeApprove(r.id, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Recipe approved', 'success');
      this._editingRecipe = res.data;
      this.renderRecipeEditor(el, res.data);
    });
    document.getElementById('rr-reject')?.addEventListener('click', async () => {
      const notes = prompt('Rejection reason:') || '';
      const res = await API.recipeReject(r.id, notes, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Rejected', 'success');
      this._editingRecipe = res.data;
      this.renderRecipeEditor(el, res.data);
    });
    document.getElementById('rr-create-pos')?.addEventListener('click', async () => {
      const res = await API.recipeCreateProduct(r.id, { new_arrival_days: parseInt(document.getElementById('rr-arrival').value, 10) }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast(`POS product created: ${res.data?.product?.name || 'OK'}`, 'success');
      this._editingRecipe = res.data.recipe;
      this.renderRecipeEditor(el, res.data.recipe);
    });
    document.getElementById('rr-archive')?.addEventListener('click', async () => {
      const res = await API.recipeArchive(r.id, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Archived', 'success');
      this._editingRecipe = null;
      this.pageRecipes(el);
    });
    document.getElementById('rr-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this recipe?')) return;
      const res = await API.recipeDelete(r.id, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Deleted', 'success');
      this._editingRecipe = null;
      this.pageRecipes(el);
    });
    recalc();
  },

  /* ── Approvals ─────────────────────────────────────────────────────────── */
  async pageApprovals(el) {
    const [pendingRes, prodRes] = await Promise.all([
      API.recipeList({ status: 'pending', ...this.branchFilter() }, this.user),
      API.recipeProductionMeals ? API.recipeProductionMeals(this.user, this.branchFilter()) : Promise.resolve({ data: {} })
    ]);
    const list = pendingRes.data || [];
    const meals = (prodRes.data?.meals || []).filter(m => m.profile_status === 'pending' || m.profile_status === 'draft');
    const can = RecipePerms.can(this.user, 'approve');
    el.innerHTML = `<div class="rp-panel"><h3>Pending Recipe Approvals</h3>
      <p class="rp-muted">Approve meal recipes before Production Planning. Saving a meal as owner/manager auto-approves.</p>
      <div class="rp-toolbar" style="margin-bottom:8px">${this.docActionsHtml('rp-appr')}</div>
      <table class="rp-table"><thead><tr><th>Recipe / Meal</th><th>Cost</th><th>Suggested</th><th></th></tr></thead>
      <tbody>${list.map(x => `<tr>
        <td><strong>${x.name}</strong>${x.product_id ? ' <span class="rp-tag ok">Meal</span>' : ''}</td>
        <td>${this.money(x.recipe_cost)}</td><td>${this.money(x.suggested_price)}</td>
        <td style="white-space:nowrap">${can ? `<button class="btn btn-sm btn-success rp-appr" data-id="${x.id}">Approve</button>
          <button class="btn btn-sm btn-danger rp-rej" data-id="${x.id}">Reject</button>` : '<span class="rp-muted">View only</span>'}
          <button class="btn btn-sm btn-ghost rp-open" data-id="${x.id}" data-pid="${x.product_id || ''}">Open</button>
          ${RecipePerms.can(this.user, 'delete') ? `<button class="btn btn-sm btn-danger rp-del" data-id="${x.id}">Delete</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="4" class="rp-muted">No pending recipes</td></tr>'}
      </tbody></table></div>
      ${meals.length ? `<div class="rp-panel"><h3>Meals needing approval</h3>
        <table class="rp-table"><thead><tr><th>Meal</th><th>Status</th><th></th></tr></thead>
        <tbody>${meals.map(m => `<tr>
          <td>${m.name}</td><td>${this.statusTag(m.profile_status || 'draft')}</td>
          <td>${can && m.profile_id ? `<button class="btn btn-sm btn-success rp-appr" data-id="${m.profile_id}">Approve</button>
            <button class="btn btn-sm btn-danger rp-rej" data-id="${m.profile_id}">Reject</button>` : ''}
            <button class="btn btn-sm btn-ghost rp-open-meal" data-pid="${m.product_id}">Open meal</button>
            ${can && m.product_id ? `<button class="btn btn-sm btn-primary rp-ensure" data-pid="${m.product_id}">Submit &amp; Approve</button>` : ''}
            ${RecipePerms.can(this.user, 'delete') && m.profile_id ? `<button class="btn btn-sm btn-danger rp-del" data-id="${m.profile_id}">Delete</button>` : ''}
          </td></tr>`).join('')}</tbody></table></div>` : ''}`;
    this.bindDocActions('rp-appr', () => ({
      title: 'Pending Recipe Approvals',
      filename: `recipe-approvals-${Date.now()}.pdf`,
      rows: (list || []).map(x => ({
        name: x.name,
        cost: x.recipe_cost,
        suggested: x.suggested_price,
        status: x.status || 'pending'
      })),
      keys: ['name', 'cost', 'suggested', 'status']
    }));
    el.querySelectorAll('.rp-appr').forEach(b => b.onclick = async () => {
      const res = await API.recipeApprove(parseInt(b.dataset.id, 10), this.user);
      Utils.toast(res.success ? 'Approved — ready for Production' : res.error, res.success ? 'success' : 'error');
      this.pageApprovals(el);
    });
    el.querySelectorAll('.rp-rej').forEach(b => b.onclick = async () => {
      const notes = prompt('Reason:') || '';
      const res = await API.recipeReject(parseInt(b.dataset.id, 10), notes, this.user);
      Utils.toast(res.success ? 'Rejected' : res.error, res.success ? 'success' : 'error');
      this.pageApprovals(el);
    });
    el.querySelectorAll('.rp-del').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this recipe permanently? This cannot be undone.')) return;
      const res = await API.recipeDelete(parseInt(b.dataset.id, 10), this.user);
      Utils.toast(res.success ? 'Deleted' : res.error, res.success ? 'success' : 'error');
      this.pageApprovals(el);
    });
    el.querySelectorAll('.rp-open').forEach(b => b.onclick = async () => {
      const pid = parseInt(b.dataset.pid, 10);
      if (pid) {
        this.page = 'recipes';
        this._editingMealProductId = pid;
        this._useLegacyEditor = false;
        this.render();
        return;
      }
      const res = await API.recipeGet(parseInt(b.dataset.id, 10), this.user);
      this.page = 'recipes';
      this._editingRecipe = res.data;
      this._useLegacyEditor = true;
      this._editingMealProductId = null;
      this.render();
    });
    el.querySelectorAll('.rp-open-meal').forEach(b => b.onclick = () => {
      this.page = 'recipes';
      this._editingMealProductId = parseInt(b.dataset.pid, 10);
      this._useLegacyEditor = false;
      this.render();
    });
    el.querySelectorAll('.rp-ensure').forEach(b => b.onclick = async () => {
      const res = await API.recipeEnsureMealProfile(parseInt(b.dataset.pid, 10), this.user);
      Utils.toast(res.success ? 'Meal approved for production' : (res.error || 'Failed'), res.success ? 'success' : 'error');
      this.pageApprovals(el);
    });
  },

  /* ── Production ────────────────────────────────────────────────────────── */
  async pageProduction(el) {
    const [prodRes, batchesRes] = await Promise.all([
      API.recipeProductionMeals ? API.recipeProductionMeals(this.user, this.branchFilter()) : Promise.resolve({ data: {} }),
      API.recipeBatches({ ...this.branchFilter() }, this.user)
    ]);
    const approved = prodRes.data?.approved_profiles || [];
    const meals = prodRes.data?.meals || [];
    const batches = batchesRes.data || [];
    const options = [];
    approved.forEach(r => options.push({
      key: `p:${r.id}`,
      profile_id: r.id,
      product_id: r.product_id || null,
      label: `${r.name}${r.status !== 'approved' ? ` (${r.status})` : ''}`
    }));
    meals.forEach(m => {
      if (options.some(o => o.product_id && Number(o.product_id) === Number(m.product_id))) return;
      options.push({
        key: `m:${m.product_id}`,
        profile_id: m.profile_id || null,
        product_id: m.product_id,
        label: `${m.name}${m.profile_status && m.profile_status !== 'approved' ? ` — ${m.profile_status}` : ' — meal'}`
      });
    });
    el.innerHTML = `
      <div class="rp-panel">
        <h3>Plan Production</h3>
        <p class="rp-muted">Pick an approved meal/recipe, calculate capacity, then Produce (deducts ingredients).</p>
        <div class="form-grid">
          <div class="field"><label>Meal / Recipe</label>
            <select id="rp-prod-recipe">${options.map(o =>
              `<option value="${o.key}" data-profile="${o.profile_id || ''}" data-product="${o.product_id || ''}">${o.label}</option>`
            ).join('') || '<option value="">No meals with recipes yet</option>'}</select>
          </div>
          <div class="field"><label>Quantity (planned)</label><input type="number" id="rp-prod-qty" value="10" min="1"></div>
          <div class="field"><label>Actual yield (meals)</label><input type="number" id="rp-prod-actual" value="" min="0.01" step="0.01" placeholder="Same as planned if blank"></div>
        </div>
        <div class="rp-toolbar" style="margin-top:12px">
          <button class="btn btn-ghost" id="rp-prod-plan">Calculate Capacity & Cost</button>
          ${RecipePerms.can(this.user, 'produce') ? '<button class="btn btn-primary" id="rp-prod-go">Produce</button>' : ''}
          <button class="btn btn-ghost" id="rp-prod-restock">Smart Restock List</button>
          <button class="btn btn-ghost" id="rp-prod-refresh">Refresh list</button>
          ${this.docActionsHtml('rp-prod')}
        </div>
        <div id="rp-prod-result" class="rp-muted" style="margin-top:12px"></div>
      </div>
      <div class="rp-panel"><h3>Recent Batches</h3>
        <table class="rp-table"><thead><tr><th>When</th><th>Recipe</th><th>Planned</th><th>Actual</th><th>Variance</th><th>Cost</th><th>Limiting</th><th>Status</th></tr></thead>
        <tbody>${batches.map(b => {
          const planned = Number(b.planned_qty) || 0;
          const actual = Number(b.produced_qty) || 0;
          const variance = b.yield_variance_pct != null
            ? b.yield_variance_pct
            : (planned ? Math.round(((actual - planned) / planned) * 1000) / 10 : 0);
          return `<tr>
          <td>${b.completed_at || b.created_at}</td><td>${b.recipe_name || b.recipe_profile_id}</td>
          <td>${planned}</td><td>${actual}</td>
          <td class="${variance < 0 ? 'rp-muted' : ''}">${variance > 0 ? '+' : ''}${variance}%</td>
          <td>${this.money(b.production_cost)}</td>
          <td>${b.limiting_ingredient || '—'}</td><td>${b.status}</td>
        </tr>`;
        }).join('') || '<tr><td colspan="8" class="rp-muted">No batches yet</td></tr>'}
        </tbody></table>
      </div>`;
    this._prodExportRows = batches.map(b => {
      const planned = Number(b.planned_qty) || 0;
      const actual = Number(b.produced_qty) || 0;
      const variance = b.yield_variance_pct != null
        ? b.yield_variance_pct
        : (planned ? Math.round(((actual - planned) / planned) * 1000) / 10 : 0);
      return {
        when: b.completed_at || b.created_at,
        recipe: b.recipe_name || b.recipe_profile_id,
        planned,
        actual,
        variance: `${variance}%`,
        cost: b.production_cost,
        limiting: b.limiting_ingredient || '—',
        status: b.status
      };
    });
    this.bindDocActions('rp-prod', () => {
      const rows = this._prodExportRows || [];
      const keys = rows[0]?.ingredient
        ? ['recipe', 'qty', 'cost', 'limiting', 'status', 'ingredient', 'stock', 'per_meal', 'can_make', 'planned_use']
        : ['when', 'recipe', 'planned', 'actual', 'variance', 'cost', 'limiting', 'status'];
      return {
        title: rows[0]?.ingredient ? 'Production Capacity Plan' : 'Production Batches',
        filename: `production-${Date.now()}.pdf`,
        rows,
        keys
      };
    });
    const selectedPayload = () => {
      const sel = document.getElementById('rp-prod-recipe');
      const opt = sel?.selectedOptions?.[0];
      const profile_id = parseInt(opt?.dataset?.profile, 10) || null;
      const product_id = parseInt(opt?.dataset?.product, 10) || null;
      const qty = parseFloat(document.getElementById('rp-prod-qty').value) || 1;
      const actualRaw = document.getElementById('rp-prod-actual')?.value;
      const actual_qty = actualRaw !== '' && actualRaw != null ? parseFloat(actualRaw) : null;
      return {
        recipe_profile_id: profile_id || undefined,
        product_id: product_id || undefined,
        planned_qty: qty,
        actual_qty: Number.isFinite(actual_qty) ? actual_qty : undefined
      };
    };
    const showPlan = async () => {
      const payload = selectedPayload();
      if (!payload.recipe_profile_id && !payload.product_id) return Utils.toast('Select a meal/recipe first', 'error');
      const res = await API.recipePlanProduction(payload, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      const p = res.data;
      document.getElementById('rp-prod-result').innerHTML = `
        <div class="rp-cost-box">
          <div><div class="rp-muted">Max Capacity</div><strong>${p.capacity?.max_meals ?? 0}</strong></div>
          <div><div class="rp-muted">Limiting</div><strong>${p.capacity?.limiting_ingredient || '—'}</strong></div>
          <div><div class="rp-muted">Production Cost</div><strong>${this.money(p.production_cost)}</strong></div>
          <div><div class="rp-muted">Can Produce?</div><strong>${p.can_produce ? 'Yes' : 'No'}</strong></div>
        </div>
        ${p.missing?.length ? `<p class="rp-muted" style="color:var(--rp-danger)">Missing: ${p.missing.map(m => m.name).join(', ')}</p>` : ''}
        <p class="rp-muted" style="margin-top:10px">Planned ingredient use for ${payload.planned_qty} meal(s). Optional: override actual qty before Produce for variance.</p>
        <table class="rp-table" style="margin-top:10px"><thead><tr><th>Ingredient</th><th>Stock</th><th>Per meal</th><th>Planned use</th><th>Actual use</th><th>Can make</th></tr></thead>
        <tbody>${(p.capacity?.breakdown || []).map(b => `<tr data-ing="${b.ingredient_product_id || b.id || ''}">
          <td>${b.name}</td><td>${b.stock} ${b.unit}</td><td>${b.per_meal}</td>
          <td>${((Number(b.per_meal) || 0) * payload.planned_qty).toFixed(3)} ${b.unit || ''}</td>
          <td><input type="number" step="0.001" class="rp-prod-ing-actual" style="width:90px" placeholder="same"></td>
          <td>${b.can_make ?? '∞'}</td>
        </tr>`).join('')}</tbody></table>`;
      this._prodExportRows = (p.capacity?.breakdown || []).map(b => ({
        when: new Date().toLocaleString(),
        recipe: document.getElementById('rp-prod-recipe')?.selectedOptions?.[0]?.textContent || '',
        qty: payload.planned_qty,
        cost: p.production_cost,
        limiting: p.capacity?.limiting_ingredient || '—',
        status: p.can_produce ? 'can_produce' : 'blocked',
        ingredient: b.name,
        stock: `${b.stock} ${b.unit || ''}`,
        per_meal: b.per_meal,
        planned_use: ((Number(b.per_meal) || 0) * payload.planned_qty).toFixed(3),
        can_make: b.can_make ?? '∞'
      }));
    };
    document.getElementById('rp-prod-plan').onclick = showPlan;
    document.getElementById('rp-prod-refresh')?.addEventListener('click', () => this.pageProduction(el));
    document.getElementById('rp-prod-go')?.addEventListener('click', async () => {
      const payload = selectedPayload();
      if (!payload.recipe_profile_id && !payload.product_id) return Utils.toast('Select a meal/recipe first', 'error');
      const actualIngredients = [];
      el.querySelectorAll('#rp-prod-result tr[data-ing]').forEach(tr => {
        const id = parseInt(tr.dataset.ing, 10);
        const val = tr.querySelector('.rp-prod-ing-actual')?.value;
        if (!id || val === '' || val == null) return;
        const actual_qty = parseFloat(val);
        if (Number.isFinite(actual_qty)) actualIngredients.push({ ingredient_product_id: id, actual_qty });
      });
      if (actualIngredients.length) payload.actual_ingredients = actualIngredients;
      const res = await API.recipeCompleteProduction(payload, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      const v = res.data?.yield_variance_pct;
      Utils.toast(
        v != null && v !== 0
          ? `Production completed — yield variance ${v > 0 ? '+' : ''}${v}%`
          : 'Production completed — stock updated',
        'success'
      );
      this.pageProduction(el);
    });
    document.getElementById('rp-prod-restock').onclick = async () => {
      const payload = selectedPayload();
      let profileId = payload.recipe_profile_id;
      if (!profileId && payload.product_id) {
        const ens = await API.recipeEnsureMealProfile(payload.product_id, this.user);
        if (!ens.success) return Utils.toast(ens.error, 'error');
        profileId = ens.data?.id;
      }
      if (!profileId) return Utils.toast('Select a meal/recipe first', 'error');
      const res = await API.recipeRestock(profileId, payload.planned_qty, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      const s = res.data;
      document.getElementById('rp-prod-result').innerHTML = `
        <h4>Buy for ${s.target_qty} meals (est. ${this.money(s.total_est_cost)})</h4>
        <table class="rp-table"><thead><tr><th>Ingredient</th><th>Need</th><th>Have</th><th>Buy</th><th>Est.</th></tr></thead>
        <tbody>${(s.suggestions || []).map(x => `<tr><td>${x.name}</td><td>${x.needed} ${x.unit}</td><td>${x.have}</td><td><strong>${x.buy_qty}</strong></td><td>${this.money(x.est_cost)}</td></tr>`).join('')}</tbody></table>`;
    };
  },

  /* ── Waste ─────────────────────────────────────────────────────────────── */
  async pageWaste(el) {
    if (!this._ingredients.length) {
      const ing = await API.recipeIngredients({}, this.user);
      this._ingredients = ing.data || [];
    }
    const [list, mealsRes] = await Promise.all([
      API.recipeWasteList({}, this.user),
      API.recipeProductionMeals ? API.recipeProductionMeals(this.user, this.branchFilter()) : Promise.resolve({ data: {} })
    ]);
    const rows = list.data || [];
    const mealOpts = (mealsRes.data?.meals || mealsRes.data?.approved_profiles || []).map(m => ({
      id: m.profile_id || m.id,
      name: m.name
    })).filter(m => m.id);
    this._wastePhoto = null;
    el.innerHTML = `
      <div class="rp-panel">
        <h3>Record Waste</h3>
        <p class="rp-muted">A photo of the wasted item is required before submit for approval. Link the meal that caused the waste when known.</p>
        <div class="form-grid">
          <div class="field"><label>Type</label>
            <select id="rw-type">${['Burnt Food','Expired Ingredients','Overcooked Meals','Spillage','Returned Meals','Damaged Ingredients','other'].map(t => `<option>${t}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Product / Ingredient</label>
            <select id="rw-prod">${this._ingredients.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Linked meal (optional)</label>
            <select id="rw-meal"><option value="">— Not linked —</option>
              ${mealOpts.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Qty</label><input type="number" step="0.01" id="rw-qty" value="1"></div>
          <div class="field"><label>Reason</label><input id="rw-reason"></div>
        </div>
        <div class="field" style="margin-top:12px">
          <label>Photo of wasted item</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
            <button type="button" class="btn btn-ghost btn-sm" id="rw-photo-cam">Take photo</button>
            <button type="button" class="btn btn-ghost btn-sm" id="rw-photo-upload">Upload photo</button>
            <span id="rw-photo-status" class="rp-muted">No photo yet</span>
          </div>
          <div id="rw-photo-preview" style="margin-top:10px"></div>
        </div>
        ${RecipePerms.can(this.user, 'produce') ? '<button class="btn btn-warning" id="rw-save" style="margin-top:12px">Submit for Approval</button>' : ''}
      </div>
      <div class="rp-panel"><h3>Waste Log</h3>
        <div class="rp-toolbar" style="margin-bottom:8px">${this.docActionsHtml('rp-waste')}</div>
        <table class="rp-table"><thead><tr><th>Photo</th><th>When</th><th>Type</th><th>Item</th><th>Meal</th><th>Qty</th><th>Cost</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(w => `<tr>
          <td class="rw-thumb" data-path="${this.escapeAttr(w.photo_path || '')}">${w.photo_path ? '…' : '—'}</td>
          <td>${w.created_at}</td><td>${w.waste_type}</td><td>${w.product_name}</td>
          <td class="rp-muted">${w.meal_name || '—'}</td>
          <td>${w.quantity}</td><td>${this.money(w.cost)}</td><td>${this.statusTag(w.status)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost rw-view" data-id="${w.id}">View</button>
            ${w.status === 'pending' && RecipePerms.can(this.user, 'produce')
              ? `<button class="btn btn-sm btn-ghost rw-edit" data-id="${w.id}">Edit</button>` : ''}
            ${(w.status === 'pending' && RecipePerms.can(this.user, 'produce')) || RecipePerms.can(this.user, 'waste_approve')
              ? `<button class="btn btn-sm btn-danger rw-del" data-id="${w.id}">Delete</button>` : ''}
            ${w.status === 'pending' && RecipePerms.can(this.user, 'waste_approve')
            ? `<button class="btn btn-sm btn-success rw-ok" data-id="${w.id}">Approve</button>
               <button class="btn btn-sm btn-danger rw-no" data-id="${w.id}">Reject</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="9" class="rp-muted">No waste records</td></tr>'}
        </tbody></table>
      </div>`;
    this.bindDocActions('rp-waste', () => ({
      title: 'Waste Log',
      filename: `waste-log-${Date.now()}.pdf`,
      rows: (rows || []).map(w => ({
        when: w.created_at,
        type: w.waste_type,
        item: w.product_name,
        meal: w.meal_name || '',
        qty: w.quantity,
        cost: w.cost,
        status: w.status,
        reason: w.reason || ''
      })),
      keys: ['when', 'type', 'item', 'meal', 'qty', 'cost', 'status', 'reason']
    }));
    // Load attached photo thumbnails for the log
    el.querySelectorAll('.rw-thumb[data-path]').forEach(async (cell) => {
      const path = cell.dataset.path;
      if (!path) return;
      try {
        const img = await API.getImageDataUrl(path);
        if (img.success && (img.dataUrl || img.data)) {
          cell.innerHTML = `<img src="${img.dataUrl || img.data}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`;
        } else cell.textContent = '📷';
      } catch (_) { cell.textContent = '📷'; }
    });
    const setWastePreview = (src) => {
      const status = document.getElementById('rw-photo-status');
      const preview = document.getElementById('rw-photo-preview');
      if (status) status.textContent = src ? 'Photo attached' : 'No photo yet';
      if (preview) {
        preview.innerHTML = src
          ? `<img src="${src}" alt="Waste photo" style="max-width:220px;max-height:180px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">`
          : '';
      }
    };
    document.getElementById('rw-photo-cam')?.addEventListener('click', async () => {
      try {
        const dataUrl = await Utils.captureProofPhoto();
        if (!dataUrl) return;
        this._wastePhoto = { type: 'data', value: dataUrl };
        setWastePreview(dataUrl);
      } catch (err) {
        Utils.toast(err.message || 'Camera unavailable', 'error');
      }
    });
    document.getElementById('rw-photo-upload')?.addEventListener('click', async () => {
      try {
        if (API.selectImage) {
          const r = await API.selectImage('recipe-waste');
          if (r?.cancelled) return;
          if (r?.success && r.path) {
            this._wastePhoto = { type: 'path', value: r.path };
            const img = await API.getImageDataUrl(r.path);
            setWastePreview(img.success ? (img.dataUrl || img.data) : null);
            if (!img.success) document.getElementById('rw-photo-status').textContent = 'Photo attached';
            return;
          }
          if (!r?.success && r?.error) return Utils.toast(r.error, 'error');
        }
        const dataUrl = await Utils.pickProofImage();
        this._wastePhoto = { type: 'data', value: dataUrl };
        setWastePreview(dataUrl);
      } catch (err) {
        Utils.toast(err.message || 'Could not add photo', 'error');
      }
    });
    document.getElementById('rw-save')?.addEventListener('click', async () => {
      if (!this._wastePhoto?.value) return Utils.toast('Add a photo of the wasted item first', 'error');
      const payload = {
        waste_type: document.getElementById('rw-type').value,
        product_id: parseInt(document.getElementById('rw-prod').value, 10),
        recipe_profile_id: parseInt(document.getElementById('rw-meal')?.value, 10) || null,
        quantity: parseFloat(document.getElementById('rw-qty').value) || 0,
        reason: document.getElementById('rw-reason').value
      };
      if (this._wastePhoto.type === 'path') payload.photo_path = this._wastePhoto.value;
      else payload.photo_image = this._wastePhoto.value;
      const res = await API.recipeWasteRecord(payload, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      this._wastePhoto = null;
      Utils.toast('Waste submitted — awaiting manager approval', 'success');
      this.pageWaste(el);
    });
    const showWasteDetails = async (id) => {
      const w = rows.find(x => Number(x.id) === Number(id));
      if (!w) return;
      let photoHtml = '<p class="rp-muted">No photo attached</p>';
      if (w.photo_path) {
        try {
          const img = await API.getImageDataUrl(w.photo_path);
          if (img.success && (img.dataUrl || img.data)) {
            photoHtml = `<img src="${img.dataUrl || img.data}" alt="Waste" style="max-width:100%;max-height:320px;border-radius:8px;border:1px solid var(--border)">`;
          }
        } catch (_) {}
      }
      Utils.showModal('Waste request', `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Type:</strong> ${w.waste_type || '—'}</div>
          <div><strong>Item:</strong> ${w.product_name || '—'}</div>
          <div><strong>Qty:</strong> ${w.quantity} ${w.unit || ''}</div>
          <div><strong>Cost:</strong> ${this.money(w.cost)}</div>
          <div><strong>Reason:</strong> ${w.reason || '—'}</div>
          <div><strong>Status:</strong> ${w.status}</div>
          <div><strong>Recorded by:</strong> ${w.recorded_by_name || '—'}</div>
          <div><strong>When:</strong> ${w.created_at || '—'}</div>
          <div style="margin-top:8px"><strong>Photo</strong></div>
          ${photoHtml}
        </div>
      `, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    };
    el.querySelectorAll('.rw-view').forEach(b => b.onclick = () => showWasteDetails(b.dataset.id));
    el.querySelectorAll('.rw-edit').forEach(b => b.onclick = async () => {
      const w = rows.find(x => Number(x.id) === Number(b.dataset.id));
      if (!w) return;
      let editPhoto = w.photo_path ? { type: 'path', value: w.photo_path } : null;
      let previewUrl = null;
      if (w.photo_path) {
        try {
          const img = await API.getImageDataUrl(w.photo_path);
          if (img.success) previewUrl = img.dataUrl || img.data;
        } catch (_) {}
      }
      Utils.showModal('Edit waste request', `
        <div class="field"><label>Type</label>
          <select id="rw-e-type">${['Burnt Food','Expired Ingredients','Overcooked Meals','Spillage','Returned Meals','Damaged Ingredients','other'].map(t =>
            `<option ${t === w.waste_type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Product</label>
          <select id="rw-e-prod">${this._ingredients.map(p =>
            `<option value="${p.id}" ${Number(p.id) === Number(w.product_id) ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>
        <div class="field"><label>Qty</label><input type="number" step="0.01" id="rw-e-qty" value="${w.quantity}"></div>
        <div class="field"><label>Reason</label><input id="rw-e-reason" value="${this.escapeAttr(w.reason || '')}"></div>
        <div class="field"><label>Photo</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">
            <button type="button" class="btn btn-ghost btn-sm" id="rw-e-cam">Take photo</button>
            <button type="button" class="btn btn-ghost btn-sm" id="rw-e-up">Upload</button>
          </div>
          <div id="rw-e-preview">${previewUrl ? `<img src="${previewUrl}" style="max-width:200px;max-height:160px;border-radius:8px">` : '<span class="rp-muted">Current photo kept unless replaced</span>'}</div>
        </div>
      `, '<button class="btn btn-primary" id="rw-e-save">Save</button>');
      const setPrev = (src) => {
        const box = document.getElementById('rw-e-preview');
        if (box) box.innerHTML = src ? `<img src="${src}" style="max-width:200px;max-height:160px;border-radius:8px">` : '';
      };
      document.getElementById('rw-e-cam')?.addEventListener('click', async () => {
        try {
          const dataUrl = await Utils.captureProofPhoto();
          editPhoto = { type: 'data', value: dataUrl };
          setPrev(dataUrl);
        } catch (err) { Utils.toast(err.message || 'Camera failed', 'error'); }
      });
      document.getElementById('rw-e-up')?.addEventListener('click', async () => {
        try {
          const r = await API.selectImage('recipe-waste');
          if (r?.success && r.path) {
            editPhoto = { type: 'path', value: r.path };
            const img = await API.getImageDataUrl(r.path);
            setPrev(img.success ? (img.dataUrl || img.data) : null);
            return;
          }
          const dataUrl = await Utils.pickProofImage();
          editPhoto = { type: 'data', value: dataUrl };
          setPrev(dataUrl);
        } catch (err) { Utils.toast(err.message || 'Upload failed', 'error'); }
      });
      document.getElementById('rw-e-save').onclick = async () => {
        const payload = {
          waste_type: document.getElementById('rw-e-type').value,
          product_id: parseInt(document.getElementById('rw-e-prod').value, 10),
          quantity: parseFloat(document.getElementById('rw-e-qty').value) || 0,
          reason: document.getElementById('rw-e-reason').value
        };
        if (editPhoto?.type === 'path') payload.photo_path = editPhoto.value;
        if (editPhoto?.type === 'data') payload.photo_image = editPhoto.value;
        const res = await API.recipeWasteUpdate(w.id, payload, this.user);
        if (!res.success) return Utils.toast(res.error || 'Update failed', 'error');
        Utils.hideModal();
        Utils.toast('Waste request updated', 'success');
        this.pageWaste(el);
      };
    });
    el.querySelectorAll('.rw-del').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this waste record?')) return;
      const res = await API.recipeWasteDelete(parseInt(b.dataset.id, 10), this.user);
      Utils.toast(res.success ? 'Deleted' : (res.error || 'Delete failed'), res.success ? 'success' : 'error');
      this.pageWaste(el);
    });
    el.querySelectorAll('.rw-ok').forEach(b => b.onclick = async () => {
      const res = await API.recipeWasteApprove(parseInt(b.dataset.id, 10), this.user);
      Utils.toast(res.success ? 'Approved — stock deducted' : res.error, res.success ? 'success' : 'error');
      this.pageWaste(el);
    });
    el.querySelectorAll('.rw-no').forEach(b => b.onclick = async () => {
      await API.recipeWasteReject(parseInt(b.dataset.id, 10), this.user);
      this.pageWaste(el);
    });
  },

  /* ── Purchase Orders (from Restock) ────────────────────────────────────── */
  async pagePurchaseOrders(el) {
    const [poRes, supRes] = await Promise.all([
      API.recipeListPurchaseOrders({ all: false }, this.user),
      API.getSuppliers ? API.getSuppliers() : Promise.resolve({ data: [] })
    ]);
    const orders = poRes.data || [];
    const suppliers = supRes.data || [];
    el.innerHTML = `
      <div class="rp-panel">
        <h3>Recipe Purchase Orders</h3>
        <p class="rp-muted">Orders created from Restock → <strong>Create Purchase Order from filled lines</strong>. Receive stock from here or Admin Purchase Orders.</p>
        <div class="rp-toolbar">
          <button class="btn btn-ghost" id="rp-po-refresh">Refresh</button>
          <button class="btn btn-primary" id="rp-po-goto-restock">Fill lines on Restock…</button>
          ${this.docActionsHtml('rp-po')}
        </div>
        <table class="rp-table"><thead><tr>
          <th>PO #</th><th>Supplier</th><th>Total</th><th>Status</th><th>Notes</th><th>Date</th><th></th>
        </tr></thead>
        <tbody>${orders.map(o => `<tr>
          <td><strong>${o.po_number}</strong></td>
          <td>${o.supplier_name || '—'}</td>
          <td>${this.money(o.total)}</td>
          <td>${this.statusTag(o.status)}</td>
          <td class="rp-muted">${o.notes || '—'}</td>
          <td>${o.created_at || '—'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost rp-po-view" data-id="${o.id}">View</button>
            ${o.status === 'pending' || o.status === 'partial'
              ? `<button class="btn btn-sm btn-success rp-po-recv" data-id="${o.id}">Receive All</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="7" class="rp-muted">No recipe purchase orders yet — create one from Restock</td></tr>'}
        </tbody></table>
      </div>
      <div class="rp-panel">
        <h3>Tips</h3>
        <ul class="rp-muted">
          <li>Use Restock → Calculate for me, then Create Purchase Order from filled lines.</li>
          <li>Receiving a PO adds stock to the shared ingredient inventory used by POS &amp; Production.</li>
          <li>History of all recipe POs stays on this page.</li>
        </ul>
        ${suppliers.length ? `<p class="rp-muted">Suppliers available: ${suppliers.slice(0, 8).map(s => s.name).join(', ')}${suppliers.length > 8 ? '…' : ''}</p>` : ''}
      </div>`;
    this.bindDocActions('rp-po', () => ({
      title: 'Recipe Purchase Orders',
      filename: `recipe-purchase-orders-${Date.now()}.pdf`,
      rows: (orders || []).map(o => ({
        po_number: o.po_number,
        supplier: o.supplier_name || '—',
        total: o.total,
        status: o.status,
        notes: o.notes || '',
        date: o.created_at || ''
      })),
      keys: ['po_number', 'supplier', 'total', 'status', 'notes', 'date']
    }));
    document.getElementById('rp-po-refresh')?.addEventListener('click', () => this.pagePurchaseOrders(el));
    document.getElementById('rp-po-goto-restock')?.addEventListener('click', () => {
      this.page = 'restock';
      this.render();
    });
    el.querySelectorAll('.rp-po-view').forEach(b => b.onclick = async () => {
      const res = await API.getPurchaseOrder(parseInt(b.dataset.id, 10));
      if (!res.success) return Utils.toast(res.error || 'Load failed', 'error');
      const po = res.data;
      const itemRows = (po.items || []).map(i => ({
        item: i.product_name,
        qty: i.quantity,
        price: i.buying_price,
        total: i.total
      }));
      Utils.showModal(`PO ${po.po_number}`, `
        <p><strong>Status:</strong> ${po.status} · <strong>Total:</strong> ${this.money(po.total)}</p>
        <p class="rp-muted">${po.notes || ''}</p>
        <div class="rp-toolbar" style="margin-bottom:8px">
          <button class="btn btn-sm btn-ghost" id="rp-po-modal-pdf">Download PDF</button>
          <button class="btn btn-sm btn-ghost" id="rp-po-modal-print">Print A4</button>
        </div>
        <table class="rp-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${(po.items || []).map(i => `<tr>
          <td>${i.product_name}</td><td>${i.quantity}</td><td>${this.money(i.buying_price)}</td><td>${this.money(i.total)}</td>
        </tr>`).join('')}</tbody></table>
      `, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
      document.getElementById('rp-po-modal-pdf')?.addEventListener('click', () => {
        this.exportPdf(`PO-${po.po_number}.pdf`, `Purchase Order ${po.po_number}`,
          ['Item', 'Qty', 'Price', 'Total'],
          itemRows.map(r => [r.item, r.qty, r.price, r.total]));
      });
      document.getElementById('rp-po-modal-print')?.addEventListener('click', () => {
        this.printDoc(`Purchase Order ${po.po_number}`,
          ['Item', 'Qty', 'Price', 'Total'],
          itemRows.map(r => [r.item, r.qty, r.price, r.total]));
      });
    });
    el.querySelectorAll('.rp-po-recv').forEach(b => b.onclick = async () => {
      if (!confirm('Receive all items and add to stock?')) return;
      const res = await API.receivePurchaseOrder(parseInt(b.dataset.id, 10), this.user);
      Utils.toast(res.success ? 'Stock updated from PO' : (res.error || 'Receive failed'), res.success ? 'success' : 'error');
      this.pagePurchaseOrders(el);
    });
  },

  /* ── Profits & Losses ──────────────────────────────────────────────────── */
  async pageProfits(el) {
    const from = this._profitFrom || new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA');
    const to = this._profitTo || new Date().toLocaleDateString('en-CA');
    el.innerHTML = `
      <div class="rp-toolbar">
        <label class="rp-muted">From</label><input type="date" id="rp-pl-from" value="${from}">
        <label class="rp-muted">To</label><input type="date" id="rp-pl-to" value="${to}">
        <button class="btn btn-primary" id="rp-pl-run">Apply filter</button>
        ${this.docActionsHtml('rp-pl')}
      </div>
      <div id="rp-pl-out"><p class="rp-muted">Loading…</p></div>`;
    this._plExport = { meals: [], ingredients: [], waste: [] };
    this.bindDocActions('rp-pl', () => {
      const meals = this._plExport.meals || [];
      const rows = meals.map(m => ({
        meal: m.meal,
        cost: m.cost_to_make,
        sell: m.you_sell_for,
        profit: m.profit_per_meal,
        margin_pct: m.profit_margin_pct ?? 0
      }));
      return {
        title: `Profits & Losses ${this._profitFrom} → ${this._profitTo}`,
        filename: `profits-losses-${this._profitFrom}-${this._profitTo}.pdf`,
        rows,
        keys: ['meal', 'cost', 'sell', 'profit', 'margin_pct']
      };
    });
    const run = async () => {
      this._profitFrom = document.getElementById('rp-pl-from').value || from;
      this._profitTo = document.getElementById('rp-pl-to').value || to;
      const res = await API.recipeProfitsLosses({ from: this._profitFrom, to: this._profitTo }, this.user);
      if (!res.success) {
        document.getElementById('rp-pl-out').innerHTML = `<p class="error-msg">${res.error || 'Failed'}</p>`;
        return;
      }
      const d = res.data || {};
      const t = d.totals || {};
      this._plExport = { meals: d.meals || [], ingredients: d.ingredients || [], waste: d.waste || [] };
      document.getElementById('rp-pl-out').innerHTML = `
        <div class="rp-cost-box" style="margin-bottom:16px">
          <div><div class="rp-muted">Meal profit (per unit sum)</div><strong>${this.money(t.meal_profit_per_unit_sum)}</strong></div>
          <div><div class="rp-muted">Ingredient usage cost</div><strong>${this.money(t.ingredient_usage_cost)}</strong></div>
          <div><div class="rp-muted">Waste losses</div><strong>${this.money(t.waste_loss)}</strong></div>
          <div><div class="rp-muted">Net estimate</div><strong>${this.money(t.net_estimate)}</strong></div>
        </div>
        <div class="rp-panel"><h3>Meal profits</h3>
          <table class="rp-table"><thead><tr><th>Meal</th><th>Cost</th><th>Sell</th><th>Profit</th><th>Margin</th></tr></thead>
          <tbody>${(d.meals || []).map(m => `<tr>
            <td>${m.meal}</td><td>${this.money(m.cost_to_make)}</td><td>${this.money(m.you_sell_for)}</td>
            <td>${this.money(m.profit_per_meal)}</td><td>${m.profit_margin_pct ?? 0}%</td>
          </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No meals</td></tr>'}</tbody></table>
        </div>
        <div class="rp-panel"><h3>Ingredient usage (${this._profitFrom} → ${this._profitTo})</h3>
          <table class="rp-table"><thead><tr><th>Ingredient</th><th>Stock left</th><th>Used</th><th>Added</th><th>Usage cost</th></tr></thead>
          <tbody>${(d.ingredients || []).map(i => `<tr>
            <td>${i.name}</td><td>${i.stock_quantity} ${i.stock_unit || i.unit || ''}</td>
            <td>${i.qty_used}</td><td>${i.qty_added}</td><td>${this.money(i.cost_of_usage)}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No usage in range</td></tr>'}</tbody></table>
        </div>
        <div class="rp-panel"><h3>Waste / losses</h3>
          <table class="rp-table"><thead><tr><th>When</th><th>Item</th><th>Qty</th><th>Cost</th><th>Status</th></tr></thead>
          <tbody>${(d.waste || []).map(w => `<tr>
            <td>${w.created_at}</td><td>${w.product_name}</td><td>${w.quantity}</td>
            <td>${this.money(w.cost)}</td><td>${this.statusTag(w.status)}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No waste in range</td></tr>'}</tbody></table>
        </div>`;
    };
    document.getElementById('rp-pl-run').onclick = run;
    await run();
  },

  /* ── Daily Item Profits (qty sold × recipe profit) ─────────────────────── */
  async pageDailyItemProfits(el) {
    const today = new Date().toLocaleDateString('en-CA');
    const day = this._dipDay || today;
    const dayTo = this._dipDayTo || day;
    el.innerHTML = `
      <p class="rp-muted" style="margin-top:0">
        Profit for <strong>each item sold</strong> on the selected day (or range), using recipe cost when available.
        Filter by day, then Download PDF or Print on A4.
      </p>
      <div class="rp-toolbar">
        <label class="rp-muted">Day</label>
        <input type="date" id="rp-dip-day" value="${day}">
        <label class="rp-muted">To (optional)</label>
        <input type="date" id="rp-dip-day-to" value="${dayTo}">
        <button class="btn btn-ghost btn-sm" id="rp-dip-today">Today</button>
        <button class="btn btn-primary" id="rp-dip-run">Show profits</button>
        <button class="btn btn-ghost" id="rp-dip-csv">Export CSV</button>
        ${this.docActionsHtml('rp-dip')}
      </div>
      <div id="rp-dip-out"><p class="rp-muted">Loading…</p></div>`;
    this._dipRows = [];
    this.bindDocActions('rp-dip', () => {
      const rows = (this._dipRows || []).map(r => ({
        Day: r.day,
        Meal: r.meal,
        Category: r.category,
        Qty: r.qty_sold,
        'Unit sell': r.unit_sell,
        'Unit cost': r.unit_cost,
        Revenue: r.revenue,
        'Total cost': r.total_cost,
        Profit: r.profit,
        'Margin %': r.profit_margin_pct
      }));
      return {
        title: `Daily Item Profits — ${this._dipDay}${this._dipDayTo && this._dipDayTo !== this._dipDay ? ` → ${this._dipDayTo}` : ''}`,
        filename: `daily-item-profits-${this._dipDay}.pdf`,
        rows,
        keys: ['Day', 'Meal', 'Category', 'Qty', 'Unit sell', 'Unit cost', 'Revenue', 'Total cost', 'Profit', 'Margin %']
      };
    });
    const run = async () => {
      this._dipDay = document.getElementById('rp-dip-day').value || today;
      this._dipDayTo = document.getElementById('rp-dip-day-to').value || this._dipDay;
      const res = await API.recipeReports('daily_item_profits', {
        day: this._dipDay,
        from: this._dipDay,
        to: this._dipDayTo,
        day_to: this._dipDayTo
      }, this.user);
      if (!res.success) {
        document.getElementById('rp-dip-out').innerHTML = `<p class="error-msg">${res.error || 'Failed'}</p>`;
        return;
      }
      const rows = Array.isArray(res.data) ? res.data : [];
      this._dipRows = rows;
      const totals = rows.reduce((a, r) => {
        a.qty += Number(r.qty_sold) || 0;
        a.revenue += Number(r.revenue) || 0;
        a.cost += Number(r.total_cost) || 0;
        a.profit += Number(r.profit) || 0;
        return a;
      }, { qty: 0, revenue: 0, cost: 0, profit: 0 });
      const margin = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : 0;
      document.getElementById('rp-dip-out').innerHTML = `
        <div class="rp-cost-box" style="margin-bottom:16px">
          <div><div class="rp-muted">Items sold</div><strong>${totals.qty}</strong></div>
          <div><div class="rp-muted">Revenue</div><strong>${this.money(totals.revenue)}</strong></div>
          <div><div class="rp-muted">Total cost</div><strong>${this.money(totals.cost)}</strong></div>
          <div><div class="rp-muted">Total profit</div><strong>${this.money(totals.profit)}</strong></div>
          <div><div class="rp-muted">Margin</div><strong>${margin}%</strong></div>
        </div>
        <div class="rp-panel">
          <h3>Profit by item sold</h3>
          <table class="rp-table">
            <thead><tr>
              <th>Meal</th><th>Category</th><th>Qty</th><th>Unit sell</th><th>Unit cost</th>
              <th>Revenue</th><th>Total cost</th><th>Profit</th><th>Margin</th>
            </tr></thead>
            <tbody>${rows.map(r => `<tr>
              <td><strong>${r.meal || '—'}</strong></td>
              <td class="rp-muted">${r.category || '—'}</td>
              <td>${r.qty_sold}</td>
              <td>${this.money(r.unit_sell)}</td>
              <td>${this.money(r.unit_cost)}</td>
              <td>${this.money(r.revenue)}</td>
              <td>${this.money(r.total_cost)}</td>
              <td><strong>${this.money(r.profit)}</strong></td>
              <td>${r.profit_margin_pct ?? 0}%</td>
            </tr>`).join('') || '<tr><td colspan="9" class="rp-muted">No sales on this day</td></tr>'}
            </tbody>
          </table>
        </div>`;
    };
    document.getElementById('rp-dip-today').onclick = () => {
      document.getElementById('rp-dip-day').value = today;
      document.getElementById('rp-dip-day-to').value = today;
      run();
    };
    document.getElementById('rp-dip-run').onclick = run;
    document.getElementById('rp-dip-csv').onclick = () => this.exportCsv(`daily-item-profits-${this._dipDay}.csv`, this._dipRows);
    await run();
  },

  /* ── Promotions ────────────────────────────────────────────────────────── */
  async pagePromotions(el) {
    const r = await API.recipePromos(this.user);
    const list = r.data || [];
    const can = RecipePerms.can(this.user, 'promotions');
    if (!this._ingredients.length) {
      const ing = await API.recipeIngredients({}, this.user);
      this._ingredients = ing.data || [];
    }
    const recipes = (await API.recipeList({ status: 'approved', ...this.branchFilter() }, this.user)).data || [];
    const productsWithRecipe = this._ingredients.filter(p => p.has_recipe || p.production_mode);
    el.innerHTML = `
      ${can ? `<div class="rp-panel"><h3>New Promotion</h3>
        <div class="form-grid">
          <div class="field"><label>Name</label><input id="rp-promo-name"></div>
          <div class="field"><label>Type</label>
            <select id="rp-promo-type">${['percent','fixed','combo','bogo','happy_hour','weekend','holiday','flash','limited'].map(t => `<option value="${t}">${t}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Value</label><input type="number" step="0.01" id="rp-promo-val" value="10"></div>
          <div class="field"><label>Start Date</label><input type="date" id="rp-promo-sd"></div>
          <div class="field"><label>End Date</label><input type="date" id="rp-promo-ed"></div>
          <div class="field"><label>Start Time</label><input type="time" id="rp-promo-st"></div>
          <div class="field"><label>End Time</label><input type="time" id="rp-promo-et"></div>
          <div class="field full"><label>Products (POS sync)</label>
            <select id="rp-promo-products" multiple size="5" style="min-height:100px">
              ${(productsWithRecipe.length ? productsWithRecipe : this._ingredients).slice(0, 200).map(p =>
                `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="field full"><label>Recipes</label>
            <select id="rp-promo-recipes" multiple size="4" style="min-height:80px">
              ${recipes.map(x => `<option value="${x.id}">${x.name}</option>`).join('')}
            </select>
          </div>
          <div class="field full"><label>Customer Groups (comma-separated)</label><input id="rp-promo-groups" placeholder="vip, walk-in"></div>
        </div>
        <button class="btn btn-primary" id="rp-promo-save" style="margin-top:12px">Save Promotion (applies on POS)</button>
      </div>` : ''}
      <div class="rp-panel"><h3>Promotions</h3>
        <table class="rp-table"><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody>${list.map(p => `<tr>
          <td>${p.name}</td><td>${p.promo_type}</td><td>${p.discount_value}</td>
          <td>${p.start_date || '—'} → ${p.end_date || '—'}</td><td>${p.status}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No promotions</td></tr>'}
        </tbody></table>
      </div>`;
    document.getElementById('rp-promo-save')?.addEventListener('click', async () => {
      const productSel = document.getElementById('rp-promo-products');
      const recipeSel = document.getElementById('rp-promo-recipes');
      const product_ids = [...(productSel?.selectedOptions || [])].map(o => parseInt(o.value, 10));
      const recipe_ids = [...(recipeSel?.selectedOptions || [])].map(o => parseInt(o.value, 10));
      const groups = (document.getElementById('rp-promo-groups').value || '').split(',').map(s => s.trim()).filter(Boolean);
      const res = await API.recipePromoSave({
        name: document.getElementById('rp-promo-name').value.trim(),
        promo_type: document.getElementById('rp-promo-type').value,
        discount_value: parseFloat(document.getElementById('rp-promo-val').value) || 0,
        start_date: document.getElementById('rp-promo-sd').value || null,
        end_date: document.getElementById('rp-promo-ed').value || null,
        start_time: document.getElementById('rp-promo-st').value || null,
        end_time: document.getElementById('rp-promo-et').value || null,
        product_ids,
        recipe_ids,
        customer_groups: groups,
        status: 'active'
      }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Promotion saved — active on POS when scheduled', 'success');
      this.pagePromotions(el);
    });
  },

  /* ── Reports ───────────────────────────────────────────────────────────── */
  async pageReports(el) {
    const preferMeal = this._preferMealProfitReport;
    this._preferMealProfitReport = false;
    el.innerHTML = `
      <div class="rp-toolbar">
        <select id="rp-rpt-type">
          ${[
            ['meal_profit','Meal Cost & Profit'],['modifier_costing','With / Without Options Costing'],
            ['recipe_cost','Recipe Cost'],['food_cost','Food Cost'],['profit','Profit / Margin'],
            ['most_profitable','Most Profitable'],['least_profitable','Least Profitable'],
            ['daily_item_profits','Daily Item Profits (sold × cost)'],
            ['production','Production'],['waste','Waste'],['best_sellers','Best Sellers'],
            ['sales_by_recipe','Sales by Recipe'],['ingredient_usage','Ingredient Usage'],
            ['inventory_consumption','Inventory Consumption'],['capacity','Production Capacity'],
            ['restock','Restock Suggestions'],['promotions','Promotions'],['promo_performance','Promo Performance'],
            ['slow_movers','Slow Moving Products']
          ].map(([v, l]) => `<option value="${v}" ${preferMeal && v === 'meal_profit' ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <label class="rp-muted" style="display:flex;align-items:center;gap:6px">Target profit %
          <input type="number" id="rp-rpt-target" value="40" style="width:70px">
        </label>
        <input type="date" id="rp-rpt-from" value="${Utils.daysAgo?.(30) || ''}">
        <input type="date" id="rp-rpt-to" value="${Utils.today?.() || ''}">
        <button class="btn btn-primary" id="rp-rpt-run">Run Report</button>
        <button class="btn btn-ghost" id="rp-rpt-csv">Export CSV / Excel</button>
        ${this.docActionsHtml('rp-rpt')}
      </div>
      <div class="rp-panel" id="rp-rpt-out"><p class="rp-muted">${preferMeal ? 'Loading meal cost &amp; profit…' : 'Select a report and run'}</p></div>`;
    this._lastReportRows = [];
    this.bindDocActions('rp-rpt', () => {
      const type = document.getElementById('rp-rpt-type')?.value || 'report';
      return {
        title: `Recipe Report — ${type}`,
        filename: `recipe-${type}-${Date.now()}.pdf`,
        rows: this._lastReportRows || []
      };
    });
    const runReport = async () => {
      const type = document.getElementById('rp-rpt-type').value;
      const from = document.getElementById('rp-rpt-from').value;
      const to = document.getElementById('rp-rpt-to').value;
      const target_profit_pct = parseFloat(document.getElementById('rp-rpt-target').value) || 40;
      const res = await API.recipeReports(type, { from, to, target_qty: 50, target_profit_pct }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      const data = res.data;
      const out = document.getElementById('rp-rpt-out');
      if (Array.isArray(data)) {
        this._lastReportRows = data;
        if (!data.length) { out.innerHTML = '<p class="rp-muted">No data — save meal recipes first</p>'; return; }
        const keys = Object.keys(data[0]).filter(k => typeof data[0][k] !== 'object');
        out.innerHTML = `<table class="rp-table"><thead><tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr></thead>
          <tbody>${data.map(row => `<tr>${keys.map(k => `<td>${row[k] ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      } else {
        this._lastReportRows = [];
        out.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px">${JSON.stringify(data, null, 2)}</pre>`;
      }
    };
    document.getElementById('rp-rpt-run').onclick = runReport;
    document.getElementById('rp-rpt-csv').onclick = () => {
      const type = document.getElementById('rp-rpt-type').value;
      this.exportCsv(`recipe-${type}-${Date.now()}.csv`, this._lastReportRows);
    };
    if (preferMeal) runReport();
  },

  /* ── Users ─────────────────────────────────────────────────────────────── */
  async pageUsers(el) {
    if (!RecipePerms.can(this.user, 'users')) {
      el.innerHTML = '<p class="rp-muted">Only Recipe Administrators can manage access.</p>';
      return;
    }
    const [accessRes, usersRes] = await Promise.all([
      API.recipeAccessList(this.user),
      API.recipeListUsers(this.user)
    ]);
    const access = accessRes.data || [];
    const users = (usersRes.data || []).filter(u => u.is_active);
    el.innerHTML = `
      <div class="rp-panel">
        <h3>Grant Recipe Access</h3>
        <p class="rp-muted">Owner / Admin is never granted here — they sign in with their POS username and password only. Use this for other staff.</p>
        <div class="form-grid">
          <div class="field"><label>User</label>
            <select id="rp-acc-user">${users.map(u => `<option value="${u.id}">${u.full_name} (${u.username})</option>`).join('')}</select>
          </div>
          <div class="field"><label>Recipe Role</label>
            <select id="rp-acc-role">
              <option value="administrator">Administrator</option>
              <option value="production_manager">Production Manager</option>
              <option value="kitchen_manager">Kitchen Manager</option>
              <option value="supervisor">Supervisor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" id="rp-acc-save" style="margin-top:12px">Grant / Update Access</button>
      </div>
      <div class="rp-panel"><h3>Authorized Users</h3>
        <table class="rp-table"><thead><tr><th>Name</th><th>POS Role</th><th>Recipe Role</th><th>Enabled</th><th></th></tr></thead>
        <tbody>${access.map(a => `<tr>
          <td>${a.full_name}</td><td>${a.pos_role}</td><td>${a.recipe_role}</td>
          <td>${a.enabled ? 'Yes' : 'No'}</td>
          <td><button class="btn btn-sm btn-danger rp-acc-rm" data-id="${a.user_id}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">Owner uses username/password only. Grant staff access above.</td></tr>'}
        </tbody></table>
      </div>`;
    document.getElementById('rp-acc-save').onclick = async () => {
      const res = await API.recipeSetAccess({
        user_id: parseInt(document.getElementById('rp-acc-user').value, 10),
        recipe_role: document.getElementById('rp-acc-role').value,
        enabled: true
      }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Access updated', 'success');
      this.pageUsers(el);
    };
    el.querySelectorAll('.rp-acc-rm').forEach(b => b.onclick = async () => {
      await API.recipeRemoveAccess(parseInt(b.dataset.id, 10), this.user);
      this.pageUsers(el);
    });
  },

  /* ── Settings ──────────────────────────────────────────────────────────── */
  async pageSettings(el) {
    if (!this._ingredients.length) {
      const ing = await API.recipeIngredients({}, this.user);
      this._ingredients = ing.data || [];
    }
    const mealsRes = await API.recipeMealProducts({ ...this.branchFilter() }, this.user);
    const meals = mealsRes.data || [];
    const recipes = (await API.recipeList({ status: 'approved', ...this.branchFilter() }, this.user)).data || [];
    const best = (await API.recipeBestSellers('month', this.user)).data || [];
    const [subsRes, forecastRes, catsRes] = await Promise.all([
      API.recipeListSubs({ status: 'pending' }, this.user),
      API.recipeForecast(14, this.user),
      API.getCategories({})
    ]);
    const subs = subsRes.data || [];
    const forecast = forecastRes.data || [];
    const categories = catsRes.data || catsRes || [];
    const canSet = RecipePerms.can(this.user, 'edit') || RecipePerms.can(this.user, 'settings');
    const mealRows = meals.length ? meals : recipes.map(r => ({
      id: r.product_id, name: r.name, available_today: r.available_today,
      is_new_arrival: r.is_new_arrival, is_best_seller: 0, show_on_pos: 1
    })).filter(m => m.id);
    el.innerHTML = `
      <div class="rp-panel">
        <h3>POS menu tabs (Available Today · New Arrival · Best Seller · Sell)</h3>
        <p class="rp-muted">Control which meals appear in POS special categories and whether they can be sold.</p>
        <div style="max-height:320px;overflow:auto">
          <table class="rp-table"><thead><tr>
            <th>Meal</th><th>Available Today</th><th>New Arrival</th><th>Best Seller</th><th>Show on POS / Sell</th>
          </tr></thead>
          <tbody>${mealRows.map(m => `<tr data-id="${m.id}">
            <td><strong>${m.name}</strong></td>
            <td><input type="checkbox" class="rp-flag-avail" ${Number(m.available_today) === 1 ? 'checked' : ''} ${canSet ? '' : 'disabled'}></td>
            <td><input type="checkbox" class="rp-flag-new" ${Number(m.is_new_arrival) === 1 ? 'checked' : ''} ${canSet ? '' : 'disabled'}></td>
            <td><input type="checkbox" class="rp-flag-best" ${Number(m.is_best_seller) === 1 ? 'checked' : ''} ${canSet ? '' : 'disabled'}></td>
            <td><input type="checkbox" class="rp-flag-sell" ${m.show_on_pos === undefined || Number(m.show_on_pos) === 1 ? 'checked' : ''} ${canSet ? '' : 'disabled'}></td>
          </tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No meals yet — save recipes in Recipe Builder</td></tr>'}
          </tbody></table>
        </div>
        ${canSet ? '<button class="btn btn-primary" id="rp-save-pos-flags" style="margin-top:12px">Save POS menu flags</button>' : ''}
      </div>
      <div class="rp-panel">
        <h3>Categories — Activate / Deactivate on POS</h3>
        <p class="rp-muted">Hide or show category tabs on the POS screen.</p>
        <table class="rp-table"><thead><tr><th>Category</th><th>POS status</th><th></th></tr></thead>
        <tbody>${(Array.isArray(categories) ? categories : []).map(c => `<tr>
          <td><strong>${c.name}</strong></td>
          <td>${Number(c.show_on_pos) === 0 ? '<span class="tag">Hidden</span>' : '<span class="tag success">Active</span>'}</td>
          <td>${canSet ? `<button class="btn btn-sm btn-ghost rp-toggle-cat" data-id="${c.id}" data-on="${Number(c.show_on_pos) === 0 ? 1 : 0}">
            ${Number(c.show_on_pos) === 0 ? 'Activate on POS' : 'Deactivate on POS'}
          </button>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="3" class="rp-muted">No categories yet</td></tr>'}
        </tbody></table>
      </div>
      <div class="rp-panel">
        <h3>Best Sellers (report)</h3>
        <table class="rp-table"><thead><tr><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
        <tbody>${best.map(b => `<tr><td>${b.product_name}</td><td>${b.sold}</td><td>${this.money(b.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="rp-muted">No data</td></tr>'}
        </tbody></table>
        <div class="rp-toolbar" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-period="today">Today</button>
          <button class="btn btn-ghost btn-sm" data-period="week">Week</button>
          <button class="btn btn-ghost btn-sm" data-period="month">Month</button>
          <button class="btn btn-ghost btn-sm" data-period="year">Year</button>
          <button class="btn btn-ghost btn-sm" data-period="all">All Time</button>
        </div>
      </div>
      <div class="rp-panel">
        <h3>Stock Forecast (14 days)</h3>
        <table class="rp-table"><thead><tr><th>Ingredient</th><th>Have</th><th>Need</th><th>Buy</th><th>Days Left</th><th>Est. Cost</th></tr></thead>
        <tbody>${forecast.slice(0, 30).map(f => `<tr>
          <td>${f.name}</td><td>${f.stock_quantity}</td><td>${f.forecast_need}</td>
          <td><strong>${f.buy_qty}</strong></td><td>${f.days_left}</td><td>${this.money(f.est_cost)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="rp-muted">No production history yet</td></tr>'}
        </tbody></table>
      </div>
      <div class="rp-panel">
        <h3>Ingredient Substitution Approvals</h3>
        <p class="rp-muted">Suggested substitutes require approval before recipes change.</p>
        <table class="rp-table"><thead><tr><th>From</th><th>To</th><th>Recipe</th><th>Reason</th><th></th></tr></thead>
        <tbody>${subs.map(s => `<tr>
          <td>${s.from_name}</td><td>${s.to_name}</td><td>${s.recipe_name || '—'}</td><td>${s.reason || '—'}</td>
          <td>${RecipePerms.can(this.user, 'approve')
            ? `<button class="btn btn-sm btn-success rp-sub-ok" data-id="${s.id}">Approve</button>
               <button class="btn btn-sm btn-danger rp-sub-no" data-id="${s.id}">Reject</button>`
            : '<span class="rp-muted">Pending</span>'}
          </td></tr>`).join('') || '<tr><td colspan="5" class="rp-muted">No pending substitutions</td></tr>'}
        </tbody></table>
        ${RecipePerms.can(this.user, 'edit') ? `<div class="form-grid" style="margin-top:12px">
          <div class="field"><label>Recipe</label>
            <select id="rp-sub-recipe"><option value="">— optional —</option>${recipes.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Replace</label>
            <select id="rp-sub-from">${this._ingredients.slice(0, 300).map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
          </div>
          <div class="field"><label>With</label>
            <select id="rp-sub-to">${this._ingredients.slice(0, 300).map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Reason</label><input id="rp-sub-reason" placeholder="Out of stock"></div>
        </div>
        <button class="btn btn-warning" id="rp-sub-req" style="margin-top:8px">Request Substitution</button>` : ''}
      </div>
      <div class="rp-panel">
        <h3>System Notes</h3>
        <ul class="rp-muted">
          <li>Inventory remains the master stock database — purchases sync automatically.</li>
          <li>Approved recipes can Create Product into POS (New Arrival window auto-expires).</li>
          <li>Make-to-order deducts ingredients on POS sale; make-to-stock deducts finished goods after production.</li>
          <li>Recipe promotions with products selected apply live prices on the POS.</li>
          <li>All mutating actions are written to the Recipe activity log (user, action, old/new, branch, device).</li>
        </ul>
      </div>`;
    document.getElementById('rp-save-pos-flags')?.addEventListener('click', async () => {
      const available_today = [];
      const new_arrival = [];
      const best_seller = [];
      const show_on_pos = {};
      el.querySelectorAll('.rp-panel').item(0)?.querySelectorAll('tbody tr[data-id]').forEach(tr => {
        const id = parseInt(tr.dataset.id, 10);
        if (!id) return;
        if (tr.querySelector('.rp-flag-avail')?.checked) available_today.push(id);
        if (tr.querySelector('.rp-flag-new')?.checked) new_arrival.push(id);
        if (tr.querySelector('.rp-flag-best')?.checked) best_seller.push(id);
        show_on_pos[id] = !!tr.querySelector('.rp-flag-sell')?.checked;
      });
      const res = await API.recipeSetPosMenuFlags({ available_today, new_arrival, best_seller, show_on_pos }, this.user);
      Utils.toast(res.success ? 'POS menu flags saved' : (res.error || 'Save failed'), res.success ? 'success' : 'error');
    });
    el.querySelectorAll('.rp-toggle-cat').forEach(b => b.addEventListener('click', async () => {
      const id = parseInt(b.dataset.id, 10);
      const cat = (Array.isArray(categories) ? categories : []).find(c => Number(c.id) === id);
      if (!cat) return;
      const res = await API.saveCategory({
        id: cat.id,
        name: cat.name,
        sort_order: cat.sort_order,
        show_on_pos: Number(b.dataset.on) === 1 ? 1 : 0
      }, this.user);
      Utils.toast(res.success ? (Number(b.dataset.on) === 1 ? 'Category activated on POS' : 'Category hidden on POS') : (res.error || 'Update failed'),
        res.success ? 'success' : 'error');
      if (res.success) this.pageSettings(el);
    }));
    el.querySelectorAll('[data-period]').forEach(b => b.onclick = async () => {
      const res = await API.recipeBestSellers(b.dataset.period, this.user);
      const panels = el.querySelectorAll('.rp-panel');
      const bestPanel = Array.from(panels).find(p => p.querySelector('h3')?.textContent?.includes('Best Sellers'));
      const tbody = bestPanel?.querySelector('tbody');
      if (tbody) tbody.innerHTML = (res.data || []).map(x => `<tr><td>${x.product_name}</td><td>${x.sold}</td><td>${this.money(x.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="rp-muted">No data</td></tr>';
    });
    el.querySelectorAll('.rp-sub-ok').forEach(b => b.onclick = async () => {
      const res = await API.recipeApproveSub(parseInt(b.dataset.id, 10), this.user);
      Utils.toast(res.success ? 'Substitution applied to recipe' : res.error, res.success ? 'success' : 'error');
      this.pageSettings(el);
    });
    el.querySelectorAll('.rp-sub-no').forEach(b => b.onclick = async () => {
      await API.recipeRejectSub(parseInt(b.dataset.id, 10), this.user);
      this.pageSettings(el);
    });
    document.getElementById('rp-sub-req')?.addEventListener('click', async () => {
      const res = await API.recipeRequestSub({
        recipe_profile_id: parseInt(document.getElementById('rp-sub-recipe').value, 10) || null,
        from_product_id: parseInt(document.getElementById('rp-sub-from').value, 10),
        to_product_id: parseInt(document.getElementById('rp-sub-to').value, 10),
        reason: document.getElementById('rp-sub-reason').value
      }, this.user);
      if (!res.success) return Utils.toast(res.error, 'error');
      Utils.toast('Substitution submitted for approval', 'success');
      this.pageSettings(el);
    });
  }
};

window.RecipeProductionApp = RecipeProductionApp;
window.RecipePerms = RecipePerms;
