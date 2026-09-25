const PlatformApp = {
  view: 'login',
  tab: 'applications',
  user: null,
  modules: [],
  packages: [],
  addons: [],
  shops: [],
  applications: [],

  asArray(v, ...keys) {
    let cur = v;
    // Unwrap nested RPC envelopes: { success, data: { shops: [...] } } etc.
    for (let depth = 0; depth < 5 && cur && typeof cur === 'object' && !Array.isArray(cur); depth++) {
      if (Array.isArray(cur)) break;
      for (const k of keys) {
        if (Array.isArray(cur[k])) return cur[k];
      }
      if (Array.isArray(cur.shops)) return cur.shops;
      if (Array.isArray(cur.applications)) return cur.applications;
      if (Array.isArray(cur.modules)) return cur.modules;
      if (Array.isArray(cur.data)) return cur.data;
      if (cur.data && typeof cur.data === 'object') {
        cur = cur.data;
        continue;
      }
      break;
    }
    if (Array.isArray(cur)) return cur;
    for (const k of keys) {
      if (Array.isArray(cur?.[k])) return cur[k];
    }
    return [];
  },

  /** Pull total/limit/offset from nested list payloads */
  listMeta(v) {
    let cur = v;
    for (let depth = 0; depth < 5 && cur && typeof cur === 'object' && !Array.isArray(cur); depth++) {
      if (cur.total != null || cur.shops || cur.applications || cur.data) {
        if (cur.total != null) {
          return { total: Number(cur.total) || 0, limit: cur.limit, offset: cur.offset };
        }
      }
      if (cur.data && typeof cur.data === 'object' && !Array.isArray(cur.data)) {
        cur = cur.data;
        continue;
      }
      break;
    }
    return { total: null, limit: null, offset: null };
  },
  selectedApplication: null,
  appFilter: '',
  appStatusFilter: '',
  appBusy: false,
  shopPage: 0,
  shopPageSize: 50,
  shopsTotal: 0,
  appPage: 0,
  appPageSize: 50,
  applicationsTotal: 0,
  catalogLoadedAt: 0,
  tabLoaded: {},
  tabLoading: {},
  selectedShop: null,
  editingShopId: null,
  provisionPreview: null,
  provisionStatus: '',
  provisionError: '',
  provisionBusy: false,
  provisionFailed: false,
  provisionPollTimer: null,
  shopHealthPreview: null,
  shopFilter: '',
  shopStatusFilter: '',
  control: null,
  lastActivation: null,
  contracts: [],
  selectedContract: null,
  contractAcceptances: [],
  feeReport: null,
  profileSection: 'overview',
  assignment: null,
  entitlementsPreview: null,
  filterKind: '',
  q: '',
  draft: null,
  addonDraft: null,
  message: '',
  error: '',
  shellReady: false,
  bootMs: 0,

  _cacheKey: 'platform_ui_cache_v1',

  hydrateFromCache() {
    try {
      const raw = localStorage.getItem(this._cacheKey);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c || !c.at || (Date.now() - c.at) > 30 * 60 * 1000) return;
      if (Array.isArray(c.packages)) this.packages = c.packages;
      if (Array.isArray(c.addons)) this.addons = c.addons;
      if (Array.isArray(c.modules)) this.modules = c.modules;
      if (c.catalogLoadedAt) this.catalogLoadedAt = c.catalogLoadedAt;
      if (Array.isArray(c.applications)) {
        this.applications = c.applications;
        this.applicationsTotal = c.applicationsTotal || c.applications.length;
        this.tabLoaded.applications = c.at;
      }
      if (Array.isArray(c.shops)) {
        this.shops = c.shops;
        this.shopsTotal = c.shopsTotal || c.shops.length;
        this.tabLoaded.shops = c.at;
      }
      if (c.user) this.user = c.user;
      if (c.tab) this.tab = c.tab;
    } catch (_) { /* */ }
  },

  persistCache() {
    try {
      localStorage.setItem(this._cacheKey, JSON.stringify({
        at: Date.now(),
        catalogLoadedAt: this.catalogLoadedAt,
        packages: this.packages,
        addons: this.addons,
        modules: this.modules,
        applications: this.applications.slice(0, 50),
        applicationsTotal: this.applicationsTotal,
        shops: this.shops.slice(0, 50),
        shopsTotal: this.shopsTotal,
        user: this.user,
        tab: this.tab
      }));
    } catch (_) { /* */ }
  },

  async init() {
    const t0 = performance.now();
    this.hydrateFromCache();

    // Paint immediately — never wait on network for first frame
    if (localStorage.getItem('platform_token')) {
      this.view = 'app';
      this.shellReady = true;
      this.render();
      this.bootBackground(t0);
      return;
    }

    this.view = 'login';
    this.render();
    // Soft enablement check in background (does not block login form)
    PlatformAPI.status().then((st) => {
      if (st && st.enabled === false) {
        this.view = 'disabled';
        this.render();
      }
    }).catch(() => { /* stay on login */ });
  },

  async bootBackground(t0) {
    try {
      const hadCache = (this.applications.length > 0) || (this.shops.length > 0);
      // Soft refresh — skip if tab still fresh; never block first paint on catalog
      await this.ensureTabData(this.tab || 'applications', { force: !hadCache });
      this.persistCache();
      this.render();
      this.warmCatalog();
    } catch (e) {
      if (/session|expired|not authenticated/i.test(String(e.message || ''))) {
        localStorage.removeItem('platform_token');
        this.view = 'login';
        this.render();
        return;
      }
      this.error = e.message;
      this.render();
    } finally {
      this.bootMs = Math.round(performance.now() - (t0 || performance.now()));
      this.render();
    }
  },

  async loadAll() {
    await this.ensureTabData(this.tab || 'applications', { force: true });
    this.persistCache();
    this.warmCatalog();
  },

  warmCatalog() {
    if (this._warmingCatalog) return;
    const stale = !this.catalogLoadedAt || (Date.now() - this.catalogLoadedAt > 5 * 60 * 1000);
    if (!stale && this.packages.length) return;
    this._warmingCatalog = true;
    this.loadCatalog()
      .then(() => this.persistCache())
      .catch(() => { /* */ })
      .finally(() => { this._warmingCatalog = false; });
  },

  async loadCatalog() {
    const [mods, pkgs, adds] = await Promise.all([
      PlatformAPI.listModules({}),
      PlatformAPI.listPackages(),
      PlatformAPI.listAddons()
    ]);
    this.modules = this.asArray(mods, 'data', 'modules');
    this.packages = this.asArray(pkgs, 'data', 'packages');
    this.addons = this.asArray(adds, 'data', 'addons');
    this.catalogLoadedAt = Date.now();
  },

  async ensureTabData(tab, opts = {}) {
    const t = tab || this.tab || 'applications';
    const freshMs = 20000;
    if (!opts.force && this.tabLoaded[t] && (Date.now() - this.tabLoaded[t]) < freshMs) {
      return;
    }
    // Reuse in-flight load instead of no-op (prevents Customers tab stuck forever)
    if (this._tabLoadPromises?.[t]) {
      return this._tabLoadPromises[t];
    }
    this.tabLoading[t] = true;
    this._tabLoadPromises = this._tabLoadPromises || {};
    const run = (async () => {
      try {
        // Catalog only when the tab actually needs package/addon pickers
        if (t === 'packages' || t === 'addons' || t === 'modules' || t === 'assign') {
          if (!this.catalogLoadedAt || (Date.now() - this.catalogLoadedAt > 5 * 60 * 1000) || !this.packages.length) {
            await this.loadCatalog();
          }
        }
        if (t === 'shops') {
          // Load customers first — never block the list on catalog (that hung the Open/Customers UI)
          if (opts.force) PlatformAPI.invalidate('platform:listShops');
          const list = await PlatformAPI.listShops({
            q: this.shopFilter || undefined,
            subscription_status: this.shopStatusFilter || undefined,
            limit: this.shopPageSize,
            offset: this.shopPage * this.shopPageSize
          });
          this.shops = this.asArray(list, 'shops', 'data');
          // If unwrap still failed, accept raw array / nested data
          if (!this.shops.length && list) {
            if (Array.isArray(list)) this.shops = list;
            else if (Array.isArray(list.data)) this.shops = list.data;
            else if (Array.isArray(list.shops)) this.shops = list.shops;
          }
          const meta = this.listMeta(list);
          this.shopsTotal = meta.total != null ? meta.total : this.shops.length;
          this.warmCatalog();
        } else if (t === 'applications') {
          if (opts.force) PlatformAPI.invalidate('platform:listApplications');
          const apps = await PlatformAPI.listApplications({
            q: this.appFilter || undefined,
            status: this.appStatusFilter || undefined,
            limit: this.appPageSize,
            offset: this.appPage * this.appPageSize
          });
          this.applications = this.asArray(apps, 'applications', 'data');
          const meta = this.listMeta(apps);
          this.applicationsTotal = meta.total != null ? meta.total : this.applications.length;
          this.warmCatalog();
        } else if (t === 'contracts') {
          const cvs = await PlatformAPI.listContractVersions();
          this.contracts = Array.isArray(cvs) ? cvs : (cvs?.data || []);
        } else if (t === 'assign') {
          try {
            const asg = await PlatformAPI.getShopAssignment('lab');
            this.assignment = asg.data || asg;
            this.entitlementsPreview = this.assignment?.entitlements || null;
          } catch (_) {
            this.assignment = { shop_key: 'lab', package_id: null, addon_ids: [], overrides: [] };
          }
        }
        this.tabLoaded[t] = Date.now();
      } finally {
        this.tabLoading[t] = false;
        if (this._tabLoadPromises) delete this._tabLoadPromises[t];
      }
    })();
    this._tabLoadPromises[t] = run;
    return run;
  },

  invalidateTab(tab) {
    if (tab) delete this.tabLoaded[tab];
    else this.tabLoaded = {};
    if (!tab || tab === 'shops') PlatformAPI.invalidate('platform:listShops');
    if (!tab || tab === 'applications') PlatformAPI.invalidate('platform:listApplications');
    if (!tab || tab === 'contracts') PlatformAPI.invalidate('platform:listContractVersions');
    if (!tab || tab === 'packages' || tab === 'addons' || tab === 'modules') {
      PlatformAPI.invalidate('platform:listPackages');
      PlatformAPI.invalidate('platform:listAddons');
      PlatformAPI.invalidate('platform:listModules');
      this.catalogLoadedAt = 0;
    }
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /** Professional label: UNDER_REVIEW → Under Review */
  pretty(value, fallback = '—') {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    return raw
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  },

  formatWhen(iso) {
    if (!iso) return '—';
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      try {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) {
          return d.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
        }
      } catch (_) { /* */ }
      return s.slice(0, 19).replace('T', ' ');
    }
    return s;
  },

  statusBadge(status) {
    const st = String(status || '').toUpperCase();
    let cls = '';
    if (['ACTIVE', 'APPROVED', 'READY', 'TRIAL', 'ONLINE'].includes(st) || st.includes('ACTIVE')) cls = 'sellable';
    else if (['SUSPENDED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(st)) cls = 'danger';
    else if (['OVERDUE', 'MORE_INFORMATION_REQUIRED', 'UNDER_REVIEW', 'PENDING'].includes(st)) cls = 'warn';
    return `<span class="badge ${cls}">${this.esc(this.pretty(st))}</span>`;
  },

  infoGrid(rows) {
    const items = (rows || []).filter((r) => r && (r.value != null && String(r.value).trim() !== '' || r.showEmpty));
    if (!items.length) return '<p class="muted">No details available.</p>';
    return `<div class="info-grid">${items.map((r) => `
      <div class="info-item">
        <span class="k">${this.esc(r.label)}</span>
        <span class="v${r.mono ? ' mono' : ''}">${r.html != null ? r.html : this.esc(r.value == null || r.value === '' ? '—' : r.value)}</span>
      </div>`).join('')}</div>`;
  },

  modal(opts = {}) {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'pf-modal-root';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      const title = this.esc(opts.title || 'Confirm');
      const message = this.esc(opts.message || '');
      const inputType = opts.input ? (opts.inputType || 'text') : null;
      const inputHtml = inputType
        ? (inputType === 'textarea'
          ? `<textarea id="pf-modal-input" rows="4" placeholder="${this.esc(opts.placeholder || '')}">${this.esc(opts.value || '')}</textarea>`
          : `<input id="pf-modal-input" type="${this.esc(inputType)}" value="${this.esc(opts.value || '')}" placeholder="${this.esc(opts.placeholder || '')}">`)
        : '';
      const okLabel = this.esc(opts.okLabel || 'Confirm');
      const cancelLabel = this.esc(opts.cancelLabel || 'Cancel');
      const danger = opts.danger ? ' danger' : '';
      root.innerHTML = `<div class="pf-modal">
        <h3>${title}</h3>
        ${message ? `<p>${message}</p>` : ''}
        ${inputHtml}
        <div class="pf-modal-actions">
          ${opts.hideCancel ? '' : `<button type="button" class="btn secondary" data-m="cancel">${cancelLabel}</button>`}
          <button type="button" class="btn${danger}" data-m="ok">${okLabel}</button>
        </div>
      </div>`;
      const finish = (val) => {
        root.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') finish(opts.input ? null : false);
        if (e.key === 'Enter' && inputType !== 'textarea') {
          e.preventDefault();
          root.querySelector('[data-m="ok"]')?.click();
        }
      };
      document.addEventListener('keydown', onKey);
      root.addEventListener('click', (e) => {
        if (e.target === root && !opts.input) finish(false);
      });
      root.querySelector('[data-m="cancel"]')?.addEventListener('click', () => finish(opts.input ? null : false));
      root.querySelector('[data-m="ok"]')?.addEventListener('click', () => {
        if (opts.input) {
          const el = root.querySelector('#pf-modal-input');
          finish(el ? el.value : '');
        } else finish(true);
      });
      document.body.appendChild(root);
      setTimeout(() => root.querySelector('#pf-modal-input, [data-m="ok"]')?.focus(), 30);
    });
  },

  confirm(message, opts = {}) {
    return this.modal({
      title: opts.title || 'Please confirm',
      message,
      okLabel: opts.okLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: !!opts.danger
    });
  },

  prompt(message, opts = {}) {
    return this.modal({
      title: opts.title || 'Enter details',
      message,
      input: true,
      inputType: opts.multiline ? 'textarea' : 'text',
      value: opts.value || '',
      placeholder: opts.placeholder || '',
      okLabel: opts.okLabel || 'Continue',
      cancelLabel: opts.cancelLabel || 'Cancel'
    });
  },

  alert(message, opts = {}) {
    return this.modal({
      title: opts.title || 'Notice',
      message,
      okLabel: opts.okLabel || 'OK',
      hideCancel: true
    });
  },

  isoToDateInput(iso) {
    if (!iso) return '';
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  },

  collectCustomerForm() {
    const addon_ids = [...document.querySelectorAll('#sh-addons input:checked')].map((el) => el.value);
    const start = document.getElementById('sh-start')?.value;
    const expiry = document.getElementById('sh-expiry')?.value;
    const toIso = (d, end) => d ? new Date(d + (end ? 'T23:59:59.000Z' : 'T00:00:00.000Z')).toISOString() : null;
    return {
      shop_name: document.getElementById('sh-name')?.value.trim() || '',
      owner_name: document.getElementById('sh-owner')?.value.trim() || '',
      owner_email: document.getElementById('sh-email')?.value.trim() || '',
      contact_phone: document.getElementById('sh-phone')?.value.trim() || '',
      whatsapp: document.getElementById('sh-whatsapp')?.value.trim() || '',
      owner_id_number: document.getElementById('sh-idnum')?.value.trim() || '',
      company_name: document.getElementById('sh-company')?.value.trim() || '',
      company_registration: document.getElementById('sh-compreg')?.value.trim() || '',
      address: document.getElementById('sh-address')?.value.trim() || '',
      postal_address: document.getElementById('sh-postal')?.value.trim() || '',
      shop_address: document.getElementById('sh-shopaddr')?.value.trim() || '',
      shop_phone: document.getElementById('sh-shopphone')?.value.trim() || '',
      branch_info: document.getElementById('sh-branch')?.value.trim() || '',
      package_id: document.getElementById('sh-pkg')?.value || null,
      addon_ids,
      subscription_status: document.getElementById('sh-status')?.value || 'ACTIVE',
      subscription_start: toIso(start, false),
      subscription_expiry: toIso(expiry, true),
      grace_days: Number(document.getElementById('sh-grace')?.value || 3),
      notes: document.getElementById('sh-notes')?.value.trim() || ''
    };
  },

  fillCustomerForm(shop) {
    if (!shop) return;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val == null ? '' : String(val);
    };
    set('sh-name', shop.shop_name || '');
    set('sh-owner', shop.owner_name || '');
    set('sh-email', shop.owner_email || '');
    set('sh-phone', shop.contact_phone || '');
    set('sh-whatsapp', shop.whatsapp || shop.contact_phone || '');
    set('sh-idnum', shop.owner_id_number || '');
    set('sh-company', shop.company_name || '');
    set('sh-compreg', shop.company_registration || '');
    set('sh-address', shop.address || '');
    set('sh-postal', shop.postal_address || '');
    set('sh-shopaddr', shop.shop_address || shop.address || '');
    set('sh-shopphone', shop.shop_phone || shop.contact_phone || '');
    set('sh-branch', shop.branch_info || '');
    set('sh-pkg', shop.package_id || '');
    set('sh-status', shop.subscription_status || 'ACTIVE');
    set('sh-start', this.isoToDateInput(shop.subscription_start || shop.trial_start || shop.countdown?.start_date));
    set('sh-expiry', this.isoToDateInput(shop.subscription_expiry || shop.trial_end || shop.countdown?.expiry_date));
    set('sh-grace', shop.grace_days != null ? shop.grace_days : (shop.countdown?.grace_period_days ?? 3));
    set('sh-notes', shop.notes || '');
    const addons = new Set(shop.addon_ids || []);
    document.querySelectorAll('#sh-addons input[type=checkbox]').forEach((el) => {
      el.checked = addons.has(el.value);
    });
    try {
      document.getElementById('sh-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) { /* */ }
  },

  async beginEditShop(id) {
    let shop = await PlatformAPI.getShop(id);
    // Unwrap nested envelopes
    for (let i = 0; i < 3 && shop && !shop.id && shop.data; i++) shop = shop.data;
    if (!shop?.id) throw new Error('Could not load customer');
    this.selectedShop = shop;
    this.editingShopId = shop.id;
    this.error = '';
    this.message = `Editing ${shop.shop_name} — update fields and Save changes`;
    this.render();
    this.fillCustomerForm(shop);
  },

  async deleteShopFlow(id) {
    const shop = this.shops.find((x) => x.id === id) || (this.selectedShop?.id === id ? this.selectedShop : null) || await PlatformAPI.getShop(id);
    const status = String(shop?.subscription_status || '').toUpperCase();
    if (status !== 'SUSPENDED') {
      throw new Error('Suspend this shop first (set Status to Suspended and Update status). Online / active shops cannot be deleted.');
    }
    const ok = await this.confirm(
      `Delete "${shop.shop_name}" from Platform Control?\n\nThis removes the Platform customer record.\nIt does NOT destroy the Railway project.\n\nShop ID: ${shop.id}`,
      { title: 'Delete customer', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    await PlatformAPI.deleteShop(id);
    if (this.selectedShop?.id === id) this.selectedShop = null;
    if (this.editingShopId === id) this.editingShopId = null;
    this.invalidateTab('shops');
    await this.loadAll();
    this.message = `Deleted ${shop.shop_name} from Platform (was suspended)`;
    this.error = '';
    this.render();
  },

  openSignedContractWindow(doc) {
    const w = window.open('', '_blank');
    if (!w) {
      this.error = 'Pop-up blocked — allow pop-ups to view signed contract';
      this.render();
      return;
    }
    const sig = doc.signature_data
      ? `<p><strong>Signature</strong></p><img src="${doc.signature_data}" alt="Signature" style="max-width:360px;border:1px solid #ccc;background:#fff" />`
      : '<p class="muted">No drawn signature on this acceptance</p>';
    w.document.write(`<!DOCTYPE html><html><head><title>Accepted Contract ${this.esc(doc.acceptance_id || '')}</title>
      <style>body{font-family:Georgia,serif;padding:24px;line-height:1.45;max-width:800px;margin:0 auto}
      pre{white-space:pre-wrap;background:#f8fafc;padding:16px;border:1px solid #e2e8f0}</style></head><body>
      <h1>${this.esc(doc.title || 'Accepted Contract')}</h1>
      <p>Version ${this.esc(doc.version_label || '')} · Acceptance ID ${this.esc(doc.acceptance_id || '')}</p>
      <p>Shop: ${this.esc(doc.shop_name || '')} (${this.esc(doc.shop_id || '')})</p>
      <p>Accepted ${this.esc(doc.accepted_at || '')} by ${this.esc(doc.accepted_by_name || '')} &lt;${this.esc(doc.accepted_by_email || '')}&gt;</p>
      <pre>${this.esc(doc.body_text || '')}</pre>
      ${sig}
      <p><em>${this.esc(doc.legal_notice || '')}</em></p>
      <script>window.print()</script>
      </body></html>`);
    w.document.close();
  },

  badge(cls) {
    const map = { shared_core: 'core', sellable: 'sellable', dependent: 'dep', admin_submodule: 'admin', feature: 'admin', legacy_compat: 'core' };
    return `<span class="badge ${map[cls] || ''}">${this.esc(cls)}</span>`;
  },

  filteredModules() {
    let list = this.modules.slice();
    if (this.filterKind) list = list.filter((m) => m.kind === this.filterKind || m.commercial_class === this.filterKind);
    if (this.q) {
      const q = this.q.toLowerCase();
      list = list.filter((m) => `${m.id} ${m.name} ${m.description}`.toLowerCase().includes(q));
    }
    return list;
  },

  render() {
    const el = document.getElementById('app');
    if (this.view === 'disabled') {
      el.innerHTML = `<div class="wrap"><div class="card"><h1>Platform Control</h1>
        <p class="err">Not enabled on this deployment (PLATFORM_CONTROL_ENABLED).</p>
        <p class="muted">Chisa Food production should never enable this. Use shoppos-saas-lab only.</p>
        ${this.error ? `<p class="err">${this.esc(this.error)}</p>` : ''}</div></div>`;
      return;
    }
    if (this.view === 'login') {
      el.innerHTML = `<div class="wrap"><div class="card login-box">
        <h1>Platform Control</h1>
        <p class="muted">SaaS shop management, packages &amp; entitlements (Phase 5). Lab only — never Chisa Food.</p>
        <div style="margin:12px 0"><label>Username</label><input id="pf-user" autocomplete="username" value="platform"></div>
        <div style="margin:12px 0"><label>Password</label><input id="pf-pass" type="password" autocomplete="current-password"></div>
        <button class="btn" data-act="login">Sign in</button>
        <p class="err" id="pf-err"></p>
      </div></div>`;
      this.bind();
      return;
    }

    el.innerHTML = `<div class="wrap">
      <div class="shell-header">
        <div class="grow">
          <h1>Platform Control</h1>
          <div class="pill">Signed in as <strong>${this.esc(this.user?.username || 'platform')}</strong> · SaaS lab control plane${this.bootMs ? ` · ready in ${this.bootMs}ms` : ''}</div>
        </div>
        <div class="shell-actions">
          <button class="btn secondary" data-act="sync" title="Sync Zenco module catalog into Platform Control">Zenco Catalog</button>
          <button class="btn secondary" data-act="samples" title="Load sample packages and add-ons for lab testing">Lab Samples</button>
          <button class="btn secondary" data-act="lab-customers" title="Open / seed lab customers list">Lab Customers</button>
          <button class="btn ghost" data-act="logout">Sign out</button>
        </div>
      </div>
      ${this.message ? `<div class="flash info">${this.esc(this.message)}</div>` : ''}
      ${this.error ? `<div class="flash bad">${this.esc(this.error)}</div>` : ''}
      <div class="tabs">
        <button class="tab ${this.tab === 'applications' ? 'active' : ''}" data-tab="applications">Customer Applications</button>
        <button class="tab ${this.tab === 'shops' ? 'active' : ''}" data-tab="shops">Customers</button>
        <button class="tab ${this.tab === 'contracts' ? 'active' : ''}" data-tab="contracts">Contracts</button>
        <button class="tab ${this.tab === 'assign' ? 'active' : ''}" data-tab="assign">Lab Assignment</button>
        <button class="tab ${this.tab === 'packages' ? 'active' : ''}" data-tab="packages">Packages</button>
        <button class="tab ${this.tab === 'addons' ? 'active' : ''}" data-tab="addons">Add-ons</button>
        <button class="tab ${this.tab === 'modules' ? 'active' : ''}" data-tab="modules">Modules</button>
      </div>
      ${this.tabLoading[this.tab] ? '<p class="muted" style="margin:0 0 12px">Loading section…</p>' : ''}
      ${this.tab === 'applications' ? this.renderApplications() : ''}
      ${this.tab === 'shops' ? this.renderShops() : ''}
      ${this.tab === 'contracts' ? this.renderContracts() : ''}
      ${this.tab === 'assign' ? this.renderAssign() : ''}
      ${this.tab === 'packages' ? this.renderPackages() : ''}
      ${this.tab === 'addons' ? this.renderAddons() : ''}
      ${this.tab === 'modules' ? this.renderModules() : ''}
    </div>`;
    this.bind();
  },

  renderApplications() {
    const a = this.selectedApplication;
    const rows = (this.applications || []).map((row) => `
      <tr data-app-id="${this.esc(row.id)}" class="${a?.id === row.id ? 'is-selected' : ''}" style="cursor:pointer">
        <td><strong>${this.esc(row.reference)}</strong></td>
        <td>${this.esc(row.shop_name)}</td>
        <td>${this.esc(row.owner_name)}</td>
        <td>${this.esc(row.owner_email)}</td>
        <td>${this.statusBadge(row.status)}</td>
        <td class="muted">${this.esc(this.formatWhen(row.submitted_at))}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No applications yet. Public form: /register-shop</td></tr>';

    const detail = !a ? `<p class="muted">Select an application to review.</p>` : `
      <div class="row" style="margin-bottom:8px">
        <div class="grow">
          <h3 style="margin:0">${this.esc(a.shop_name)}</h3>
          <div class="muted" style="margin-top:6px">${this.esc(a.reference)} · ${this.statusBadge(a.status)}</div>
        </div>
      </div>
      ${this.infoGrid([
        { label: 'Owner', value: a.owner_name },
        { label: 'Email', value: a.owner_email },
        { label: 'WhatsApp', value: a.whatsapp || '—' },
        { label: 'Phone', value: a.phone || '—' },
        { label: 'Address', value: a.address || '—' },
        { label: 'Business Type', value: a.business_type || '—' },
        { label: 'Branches', value: String(a.branches ?? '—') },
        { label: 'Package', value: a.package_name || a.package_id || '—' },
        { label: 'Add-ons', value: (a.addon_names || []).join(', ') || '—' },
        { label: 'Submitted', value: this.formatWhen(a.submitted_at) },
        { label: 'Additional Info', value: a.additional_info || '—' },
        ...(a.shop_id ? [{ label: 'Shop ID', value: a.shop_id, mono: true }] : []),
        ...(a.activation_link ? [{ label: 'Activation Link', value: a.activation_link, mono: true }] : []),
        ...(a.info_request ? [{ label: 'Info Requested', value: a.info_request }] : []),
        ...(a.rejected_reason ? [{ label: 'Rejection Reason', value: a.rejected_reason }] : [])
      ])}
      ${a.status !== 'APPROVED' && a.status !== 'REJECTED' ? `
        <div style="margin-top:12px">
          <label>Admin notes</label>
          <textarea id="app-notes">${this.esc(a.admin_notes || '')}</textarea>
        </div>
        ${!a.package_id ? `
          <div style="margin-top:10px">
            <label>Package (required to approve)</label>
            <select id="app-pkg-override">
              <option value="">— select package —</option>
              ${this.packages.map((p) => `<option value="${this.esc(p.id)}">${this.esc(p.name)}</option>`).join('')}
            </select>
          </div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="btn secondary" data-act="app-under-review" ${this.appBusy ? 'disabled' : ''}>Under Review</button>
          <button class="btn secondary" data-act="app-more-info" ${this.appBusy ? 'disabled' : ''}>More Info Required</button>
          <button class="btn danger" data-act="app-reject" ${this.appBusy ? 'disabled' : ''}>Reject</button>
          <button class="btn" data-act="app-approve" ${this.appBusy ? 'disabled' : ''}>Approve &amp; Provision</button>
        </div>
        <p class="muted" style="margin-top:8px;font-size:.8rem">
          Approve creates the shop, starts Railway provisioning, syncs entitlements, and generates an activation link.
          Public applicants cannot approve themselves.
        </p>
      ` : (a.status === 'APPROVED'
        ? `<p class="warn" style="margin-top:12px">Approved${a.approved_by ? ' by ' + this.esc(a.approved_by) : ''}${a.approved_at ? ' at ' + this.esc(a.approved_at) : ''}.</p>`
        : `<p class="err" style="margin-top:12px">Rejected${a.rejected_reason ? ': ' + this.esc(a.rejected_reason) : ''}.</p>`)}
    `;

    return `<div class="grid2">
      <div class="card">
        <h2>Customer Applications (${this.applicationsTotal || this.applications.length})</h2>
        <p class="muted">Public submissions from <code>/register-shop</code>. Pending until you approve — no Railway or login until then.</p>
        <div class="row" style="margin-bottom:10px">
          <input id="app-q" placeholder="Search reference, name, email…" value="${this.esc(this.appFilter)}" style="flex:1">
          <select id="app-status-f" style="max-width:200px">
            <option value="">All Statuses</option>
            ${['PENDING','UNDER_REVIEW','MORE_INFORMATION_REQUIRED','APPROVED','REJECTED'].map((s) =>
              `<option value="${s}" ${this.appStatusFilter === s ? 'selected' : ''}>${this.pretty(s)}</option>`).join('')}
          </select>
          <button class="btn secondary" data-act="app-refresh">Refresh</button>
        </div>
        <div style="overflow:auto;max-height:520px">
          <table class="table">
            <thead><tr>
              <th>Reference</th><th>Business</th><th>Owner</th><th>Email</th><th>Status</th><th>Submitted</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2>Review</h2>
        ${detail}
      </div>
    </div>`;
  },

  resolveSafeShopUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return null;
    if (/chisafood|peaceful-motivation|chisanyama|chisa\s*food/i.test(raw)) return null;
    try {
      const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const u = new URL(withProto);
      if (/chisafood|peaceful-motivation|chisanyama/i.test(u.hostname)) return null;
      return `${u.protocol}//${u.host}`.replace(/\/$/, '');
    } catch (_) {
      return null;
    }
  },

  renderShops() {
    const s = this.selectedShop;
    const editing = !!this.editingShopId;
    const defStart = new Date().toISOString().slice(0, 10);
    const defEnd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const shops = this.asArray(this.shops);
    const packages = this.asArray(this.packages);
    const addons = this.asArray(this.addons);
    const pkgName = (id) => packages.find((p) => p.id === id)?.name || null;
    const openShopUrl = (this.control && s && String(this.control.customer?.id || '') === String(s.id || ''))
      ? (this.control.open_customer_shop_url || null)
      : this.resolveSafeShopUrl(s?.shop_url);
    return `<div class="grid2">
      <div class="card">
        <h2>${editing ? 'Edit Customer' : 'Create Customer'}</h2>
        <p class="muted">${editing
          ? `Editing <strong>${this.esc(this.editingShopId)}</strong> — change fields below and save. Package and status updates apply immediately.`
          : 'Registers the customer on the platform. Provisioning (Railway) is a separate step after create.'}</p>
        ${editing ? `<input type="hidden" id="sh-edit-id" value="${this.esc(this.editingShopId)}">` : ''}
        <div class="grid2" style="gap:8px">
          <div style="margin:8px 0"><label>Shop Name *</label><input id="sh-name" placeholder="Acme Cafe"></div>
          <div style="margin:8px 0"><label>Owner / Customer Name *</label><input id="sh-owner" placeholder="Jane Owner"></div>
          <div style="margin:8px 0"><label>Email *</label><input id="sh-email" type="email" placeholder="owner@example.com"></div>
          <div style="margin:8px 0"><label>Phone</label><input id="sh-phone" placeholder="+27…"></div>
          <div style="margin:8px 0"><label>WhatsApp</label><input id="sh-whatsapp" placeholder="+27…"></div>
          <div style="margin:8px 0"><label>ID / Passport / Company Reg.</label><input id="sh-idnum" placeholder="Optional"></div>
          <div style="margin:8px 0"><label>Company / Business Name</label><input id="sh-company" placeholder="Optional"></div>
          <div style="margin:8px 0"><label>Company Registration</label><input id="sh-compreg" placeholder="Optional"></div>
        </div>
        <div style="margin:8px 0"><label>Physical Address</label><input id="sh-address" placeholder="Street, city"></div>
        <div style="margin:8px 0"><label>Postal Address</label><input id="sh-postal" placeholder="If different"></div>
        <div class="grid2" style="gap:8px">
          <div style="margin:8px 0"><label>Shop Address</label><input id="sh-shopaddr" placeholder="Defaults to physical address"></div>
          <div style="margin:8px 0"><label>Shop Contact Number</label><input id="sh-shopphone" placeholder="Defaults to phone"></div>
          <div style="margin:8px 0"><label>Branch Info</label><input id="sh-branch" placeholder="Optional branch label"></div>
        </div>
        <div style="margin:8px 0"><label>Package *</label>
          <select id="sh-pkg"><option value="">— Select package —</option>
            ${packages.map((p) => `<option value="${this.esc(p.id)}">${this.esc(p.name)}</option>`).join('')}
          </select></div>
        <div style="margin:8px 0"><label>Add-ons</label>
          <div class="module-list" style="max-height:120px" id="sh-addons">
            ${addons.map((ad) => `<label class="module-item">
              <input type="checkbox" value="${this.esc(ad.id)}">
              <div><strong>${this.esc(ad.name)}</strong></div></label>`).join('') || '<p class="muted">No add-ons</p>'}
          </div></div>
        <div class="grid2" style="gap:8px">
          <div style="margin:8px 0"><label>Subscription Start</label><input id="sh-start" type="date" value="${defStart}"></div>
          <div style="margin:8px 0"><label>Subscription Expiry</label><input id="sh-expiry" type="date" value="${defEnd}"></div>
          <div style="margin:8px 0"><label>Grace Period (Days)</label><input id="sh-grace" type="number" min="0" value="3"></div>
          <div style="margin:8px 0"><label>Status</label>
            <select id="sh-status">
              <option value="TRIAL">Trial</option>
              <option value="ACTIVE" selected>Active</option>
              <option value="OVERDUE">Overdue</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="EXPIRED">Expired</option>
            </select></div>
        </div>
        <div style="margin:8px 0"><label>Notes</label><textarea id="sh-notes" rows="2" placeholder="Internal notes (optional)"></textarea></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${editing
            ? `<button class="btn" data-act="save-shop-edit">Save Changes</button>
               <button class="btn secondary" data-act="cancel-shop-edit">Cancel Edit</button>`
            : `<button class="btn" data-act="create-shop">Create Customer</button>`}
        </div>
      </div>
      <div class="card">
        <div class="section-title">
          <h2>Customers / Shops (${this.shopsTotal || shops.length})</h2>
        </div>
        <div class="row" style="margin-bottom:8px">
          <div class="grow"><input id="sh-filter" value="${this.esc(this.shopFilter)}" placeholder="Search shops…"></div>
          <select id="sh-status-filter">
            <option value="">All Statuses</option>
            ${['TRIAL','ACTIVE','OVERDUE','SUSPENDED','EXPIRED'].map((st) =>
              `<option value="${st}" ${this.shopStatusFilter === st ? 'selected' : ''}>${this.pretty(st)}</option>`).join('')}
          </select>
          <button class="btn secondary" data-act="filter-shops">Filter</button>
        </div>
        <p class="muted" style="margin:0 0 12px">Delete is only allowed after the shop is <strong>Suspended</strong>. Online or active shops cannot be deleted.</p>
        <div style="overflow:auto;max-height:560px">
        <table class="table"><thead><tr>
          <th>Shop</th><th>Owner</th><th>Package</th><th>Status</th><th>Deploy</th><th></th>
        </tr></thead><tbody>
          ${shops.map((sh) => {
            const suspended = String(sh.subscription_status || '').toUpperCase() === 'SUSPENDED';
            const selected = s?.id === sh.id;
            const addonNames = Array.isArray(sh.addon_names) ? sh.addon_names : [];
            return `<tr class="${selected ? 'is-selected' : ''}" data-open-shop-row="${this.esc(sh.id)}" style="cursor:pointer">
            <td><strong>${this.esc(sh.shop_name)}</strong>
              <div class="muted" style="margin-top:4px">${this.esc(sh.shop_url || 'No shop URL yet')}</div></td>
            <td>${this.esc(sh.owner_name || '—')}<div class="muted">${this.esc(sh.owner_email || '')}</div></td>
            <td>${this.esc(sh.package_name || pkgName(sh.package_id) || '—')}
              <div class="muted">${addonNames.map((n) => this.esc(n)).join(', ') || ''}</div></td>
            <td>${this.statusBadge(sh.subscription_status)}
              <div class="muted" style="margin-top:4px">${sh.is_active ? 'Active record' : 'Inactive record'}</div></td>
            <td>${this.statusBadge(sh.deployment_status || 'not_provisioned')}</td>
            <td style="white-space:nowrap" onclick="event.stopPropagation()">
              <button class="btn secondary" data-open-shop="${this.esc(sh.id)}">Open</button>
              <button class="btn secondary" data-edit-shop="${this.esc(sh.id)}">Edit</button>
              <button class="btn secondary" data-delete-shop="${this.esc(sh.id)}" title="${suspended ? 'Delete suspended shop from Platform' : 'Suspend this shop first, then delete'}" ${suspended ? '' : 'disabled'}>Delete</button>
            </td>
          </tr>`;
          }).join('') || '<tr><td colspan="6" class="muted">No shops yet</td></tr>'}
        </tbody></table>
        </div>
      </div>
    </div>
    ${s ? `<div class="card shop-control-card" style="margin-top:16px">
      <div class="section-title">
        <div>
          <h2 style="margin:0">Customer Shop Control</h2>
          <div class="pill" style="margin-top:6px">${this.esc(s.shop_name)} · ${this.statusBadge(s.subscription_status)} · ${this.statusBadge(s.deployment_status || 'not_provisioned')}</div>
          <p class="muted" style="margin:6px 0 0">Links and data for <strong>this customer only</strong> (Shop ID <code>${this.esc(s.id)}</code>). Never uses Chisa as a default.</p>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${openShopUrl
            ? `<a class="btn btn-lg" href="${this.esc(openShopUrl)}" target="_blank" rel="noopener" style="font-weight:700">OPEN CUSTOMER SHOP</a>`
            : `<button class="btn btn-lg" disabled title="No provisioned shop URL for this customer">OPEN CUSTOMER SHOP</button>`}
          <button class="btn secondary" data-edit-shop="${this.esc(s.id)}">Edit Customer</button>
          <button class="btn secondary" data-act="close-shop-control">Close</button>
        </div>
      </div>
      ${this.renderCustomerShopControl(s)}
    </div>` : ''}`;
  },

  /** Normalize customerControl RPC payloads (handles nested {data:{customer}}). */
  normalizeCustomerControl(raw, shopId) {
    let c = raw;
    if (!c || typeof c !== 'object') c = {};
    // Unwrap accidental double envelopes
    for (let i = 0; i < 6; i++) {
      if (c.customer || c.links || c.info || c.open_customer_shop_url) break;
      if (c.data && typeof c.data === 'object') c = c.data;
      else break;
    }
    if (!c || typeof c !== 'object') c = {};
    // Always pin identity to the shop we opened — never leave Open broken on envelope quirks
    if (shopId) {
      const cust = (c.customer && typeof c.customer === 'object') ? { ...c.customer } : {};
      if (!cust.id) cust.id = shopId;
      c = { ...c, customer: cust };
      c.info = (c.info && typeof c.info === 'object') ? { ...c.info } : {};
      if (!c.info.shop_id) c.info.shop_id = shopId;
      if (!c.info.customer_id) c.info.customer_id = shopId;
    }
    return c;
  },

  controlMatchesShop(c, shopId) {
    if (!c || !shopId) return false;
    const id = c.customer?.id || c.info?.shop_id || c.info?.customer_id;
    // After normalizeCustomerControl, id is always set for the opened shop
    return !id || String(id) === String(shopId);
  },

  async openCustomerShopControl(shopId) {
    if (!shopId) throw new Error('Missing shop id');
    this.editingShopId = null;
    this.control = null;
    this.lastActivation = null;
    this.feeReport = null;
    this.shopHealthPreview = null;
    this.profileSection = 'overview';
    this.tab = 'shops';
    this.message = 'Loading Customer Shop Control…';
    this.error = '';
    // Prefer list cache for instant paint, then refresh
    const cached = (this.shops || []).find((s) => String(s.id) === String(shopId));
    if (cached) this.selectedShop = cached;
    else this.selectedShop = { id: shopId, shop_name: '…' };
    this.render();
    try {
      let shop = null;
      try {
        shop = await PlatformAPI.getShop(shopId);
      } catch (_) { /* fall back to list cache */ }
      if (shop?.data && !shop.id) shop = shop.data;
      this.selectedShop = (shop?.id ? shop : null) || cached || { id: shopId };
      if (!this.selectedShop.id) this.selectedShop.id = shopId;
      const raw = await PlatformAPI.customerControl(shopId);
      this.control = this.normalizeCustomerControl(raw, shopId);
      if (!this.controlMatchesShop(this.control, shopId)) {
        this.control = this.normalizeCustomerControl({ ...(this.control || {}), customer: { id: shopId } }, shopId);
      }
      this.message = `Customer Shop Control · ${this.selectedShop.shop_name || shopId}`;
      this.error = '';
      this.render();
      // Scroll control panel into view
      setTimeout(() => {
        document.querySelector('.shop-control-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (e) {
      this.error = e.message || String(e);
      this.message = '';
      if (!this.selectedShop?.id) this.selectedShop = cached || { id: shopId };
      this.control = null;
      this.render();
      throw e;
    }
  },

  renderCustomerShopControl(s) {
    const c = this.normalizeCustomerControl(this.control, s?.id);
    if (!c || !this.controlMatchesShop(c, s?.id)) {
      return `<div style="padding:20px 0"><p class="muted">Loading Customer Shop Control…</p>
        <button class="btn" data-act="load-control">Load Customer Shop Control</button>
        ${this.error ? `<p class="err" style="margin-top:8px">${this.esc(this.error)}</p>` : ''}</div>`;
    }
    // keep normalized control for rest of render
    this.control = c;
    const info = c.info || {};
    const links = c.links || [];
    const cd = c.subscription || {};
    const access = c.access || {};
    const fee = c.service_fee || {};
    const acts = c.activation || [];
    const devices = c.devices || [];
    const audit = c.audit || [];
    const contract = c.contract || {};
    const jobs = c.provision_jobs || [];
    const secret = this.lastActivation;
    const feeR = this.feeReport;
    const cust = c.customer || s;
    const health = this.shopHealthPreview || c.health;

    const linkRows = links.map((l) => {
      const openBtn = l.status === 'available' || l.status === 'suspended' || (l.url && l.action === 'open')
        ? `<a class="btn secondary" href="${this.esc(l.url)}" target="_blank" rel="noopener">OPEN</a>`
        : (l.action === 'upgrade'
          ? `<span class="badge">Upgrade / Add-on Required</span>`
          : `<span class="muted">—</span>`);
      return `<tr>
        <td><strong>${this.esc(l.label)}</strong>
          ${l.note ? `<div class="muted" style="font-size:12px">${this.esc(l.note)}</div>` : ''}</td>
        <td>${this.esc(l.status_icon || '')} ${this.esc(l.status_label || l.status)}</td>
        <td class="mono muted" style="font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis">${l.url ? this.esc(l.url) : '—'}</td>
        <td style="white-space:nowrap">${openBtn}</td>
      </tr>`;
    }).join('');

    return `<div class="shop-control-body">
      <div class="tabs" style="margin:8px 0;flex-wrap:wrap">
        ${[['overview','Overview'],['links','Access Links'],['package','Package'],['activation','Activation'],['devices','Devices'],['contracts','Contracts'],['docs','Documents'],['fees','Fees'],['audit','Audit'],['provision','Provisioning']].map(([sec, label]) =>
          `<button class="tab ${this.profileSection === sec ? 'active' : ''}" data-profile-sec="${sec}">${label}</button>`).join('')}
      </div>

      ${(this.profileSection === 'overview' || !this.profileSection) ? `
      <h3>1. Shop Information</h3>
      ${this.infoGrid([
        { label: 'Business / Shop Name', value: info.shop_name || cust.shop_name },
        { label: 'Owner', value: info.owner_name || cust.owner_name },
        { label: 'Email', value: info.owner_email || cust.owner_email },
        { label: 'WhatsApp', value: info.whatsapp || cust.whatsapp },
        { label: 'Phone', value: info.phone || cust.contact_phone },
        { label: 'Address', value: info.address || cust.address },
        { label: 'Shop ID', value: info.shop_id || cust.id, mono: true },
        { label: 'Customer ID', value: info.customer_id || cust.id, mono: true },
        { label: 'Package', value: info.package_name || cust.package_name },
        { label: 'Add-ons', value: (Array.isArray(info.addon_names) ? info.addon_names : Array.isArray(cust.addon_names) ? cust.addon_names : []).join(', ') || 'None' },
        { label: 'Subscription Status', html: this.statusBadge(info.subscription_status || cust.subscription_status) },
        { label: 'Subscription Start', value: this.formatWhen(info.subscription_start || cust.subscription_start) },
        { label: 'Subscription Expiry', value: this.formatWhen(info.subscription_expiry || cust.subscription_expiry) },
        { label: 'Grace Period (days)', value: info.grace_days != null ? String(info.grace_days) : '—' },
        { label: 'Account Status', value: info.account_status || (cust.is_active ? 'active' : 'inactive') },
        { label: 'Provisioning Status', html: this.statusBadge(info.provisioning_status || cust.deployment_status) },
        { label: 'Railway Project', value: info.railway_project_id || 'Not provisioned', mono: true },
        { label: 'Environment', value: info.environment_label || '—', mono: true },
        { label: 'Customer URL', value: info.shop_url || 'Not provisioned', mono: true },
        { label: 'Access State', html: this.statusBadge(access.access_state || cust.subscription_status) },
        { label: 'Days Remaining', value: cd.days_remaining != null ? String(cd.days_remaining) : '—' },
        { label: 'Last Health Check', value: health
          ? (health.ok ? 'Healthy' : (health.message || health.error || 'Issues'))
          : 'Not checked yet' }
      ])}
      <p class="muted">Secrets (DB passwords, Railway tokens, sync secrets) are never shown.</p>
      <h3>2. Customer Access Links</h3>
      <p class="muted">From this customer's stored <code>shop_url</code> only — never a Chisa / global default.</p>
      <table class="table"><thead><tr><th>Application</th><th>Status</th><th>URL</th><th></th></tr></thead>
        <tbody>${linkRows || '<tr><td colspan="4" class="muted">No links</td></tr>'}</tbody></table>
      <h3>Platform Owner Actions</h3>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button class="btn secondary" data-edit-shop="${this.esc(s.id)}">Edit Customer</button>
        <button class="btn secondary" data-profile-sec="package">Change Package / Add-ons</button>
        <button class="btn secondary" data-act="save-shop-status">Manage Subscription</button>
        <button class="btn secondary" data-profile-sec="activation">Manage Activation</button>
        <button class="btn" data-act="gen-activation">Generate Activation Link</button>
        <button class="btn secondary" data-profile-sec="devices">Manage Devices</button>
        <button class="btn secondary" data-act="suspend-customer">Suspend Customer</button>
        <button class="btn secondary" data-act="reactivate-customer">Reactivate Customer</button>
        <button class="btn secondary" data-profile-sec="fees">Manage Service Fees</button>
        <button class="btn secondary" data-profile-sec="contracts">View Contracts / T&Cs</button>
        <button class="btn secondary" data-profile-sec="docs">Documents</button>
        <button class="btn secondary" data-profile-sec="audit">View Audit Log</button>
        <button class="btn secondary" data-profile-sec="provision">Provisioning History</button>
        <button class="btn secondary" data-act="shop-health">Check Health</button>
        <button class="btn secondary" data-act="sync-entitlements">Sync Entitlements</button>
        <button class="btn secondary" data-act="provision-run">Retry Failed Provisioning</button>
      </div>
      ` : ''}

      ${this.profileSection === 'links' ? `
      <h3>2. Customer Access Links</h3>
      <p class="muted">Generated only from this customer's stored <code>shop_url</code>. Package differences show as Not Included.</p>
      <table class="table"><thead><tr><th>Application</th><th>Status</th><th>URL</th><th></th></tr></thead>
        <tbody>${linkRows || '<tr><td colspan="4" class="muted">No links</td></tr>'}</tbody></table>
      ` : ''}

      ${this.profileSection === 'package' ? `
      <h3>Package &amp; Add-ons / Entitlements</h3>
      <div style="margin:8px 0"><label>Package</label>
        <select id="det-pkg">
          <option value="">— None —</option>
          ${this.packages.map((p) => `<option value="${this.esc(p.id)}" ${s.package_id === p.id ? 'selected' : ''}>${this.esc(p.name)}</option>`).join('')}
        </select></div>
      <div class="module-list" style="max-height:160px" id="det-addons">
        ${this.addons.map((ad) => `<label class="module-item">
          <input type="checkbox" value="${this.esc(ad.id)}" ${(s.addon_ids || []).includes(ad.id) ? 'checked' : ''}>
          <div><strong>${this.esc(ad.name)}</strong></div></label>`).join('') || '<p class="muted">No add-ons</p>'}
      </div>
      <button class="btn" data-act="save-shop-assign" style="margin-top:10px">Save Package / Add-ons</button>
      <h4 style="margin-top:16px">Subscription</h4>
      <select id="det-status">
        ${['TRIAL','ACTIVE','OVERDUE','SUSPENDED','EXPIRED'].map((st) =>
          `<option value="${st}" ${s.subscription_status === st ? 'selected' : ''}>${this.pretty(st)}</option>`).join('')}
      </select>
      <button class="btn secondary" data-act="save-shop-status" style="margin-top:8px">Update Status</button>
      <details class="advanced-block" style="margin-top:12px">
        <summary>Advanced · Module Overrides</summary>
        <textarea id="det-overrides" rows="5">${this.esc(JSON.stringify((s.overrides || []).map((o) => ({
          module_id: o.module_id, enabled: Number(o.enabled), reason: o.reason || ''
        })), null, 2))}</textarea>
        <button class="btn secondary" data-act="save-shop-overrides" style="margin-top:8px">Save Overrides</button>
      </details>
      <h4 style="margin-top:16px">Effective flags</h4>
      <table class="table"><thead><tr><th>Feature</th><th>State</th></tr></thead><tbody>
        ${Object.entries(c.entitlements_summary?.flags || s.entitlements?.flags || {}).map(([k, v]) =>
          `<tr><td>${this.esc(k)}</td><td>${v ? '<span class="badge sellable">ON</span>' : '<span class="badge">OFF</span>'}</td></tr>`
        ).join('') || '<tr><td colspan="2" class="muted">No entitlement flags</td></tr>'}
      </tbody></table>
      ` : ''}

      ${this.profileSection === 'activation' ? `
      <h3>Activation</h3>
      <div class="row">
        <button class="btn" data-act="gen-activation">Generate Activation Link</button>
        <button class="btn secondary" data-act="regen-activation">Regenerate</button>
      </div>
      ${secret ? (() => {
        const shopUrl = c.open_customer_shop_url || this.resolveSafeShopUrl(s.shop_url);
        const link = secret.activation_link
          || (shopUrl && secret.link_token
            ? `${shopUrl}/activate?token=${encodeURIComponent(secret.link_token)}&shop=${encodeURIComponent(s.id)}`
            : '');
        return `<div class="activation-box">
        <label>Complete Activation URL (customer environment only)</label>
        <input id="act-link" readonly value="${this.esc(link || '(provision customer shop URL first)')}" />
        <p class="muted" style="margin:8px 0">Code (show once): <code>${this.esc(secret.code || '—')}</code></p>
        <div class="row">
          <button class="btn" data-act="copy-activation" ${link ? '' : 'disabled'}>Copy Activation Link</button>
          ${link ? `<a class="btn secondary" href="${this.esc(link)}" target="_blank" rel="noopener">Open Activation Link</a>` : ''}
          ${acts.find((a) => a.status === 'active') ? `<button class="btn secondary" data-revoke-act="${this.esc(acts.find((a) => a.status === 'active').id)}">Revoke</button>` : ''}
        </div>
      </div>`;
      })() : '<p class="muted">Generate a link to activate devices on this customer\'s environment.</p>'}
      <h4>Activation records</h4>
      <ul class="muted">${acts.map((a) => `<li>${this.esc(a.id)} · ${this.esc(a.status)} · ${this.esc(a.created_at || '')}
        ${a.status === 'active' ? `<button class="btn secondary" data-revoke-act="${this.esc(a.id)}">Revoke</button>` : ''}</li>`).join('') || '<li>No activations</li>'}</ul>
      ` : ''}

      ${this.profileSection === 'devices' ? `
      <h3>Devices</h3>
      <ul class="muted">${devices.map((d) => `<li>${this.esc(d.device_name)} · ${this.esc(this.pretty(d.device_type))} · ${this.esc(this.pretty(d.status))}
        ${d.status !== 'revoked' ? `<button class="btn secondary" data-revoke-dev="${this.esc(d.id)}">Revoke</button>` : ''}</li>`).join('') || '<li>No devices</li>'}</ul>
      ` : ''}

      ${this.profileSection === 'contracts' ? `
      <h3>Contracts / T&Cs</h3>
      <p>Current: ${contract.accepted ? `Accepted ${this.esc(contract.latest_acceptance?.version_label || '')} at ${this.esc(contract.latest_acceptance?.accepted_at || '')}` : 'Not accepted'}
        ${contract.needs_reacceptance ? ' · <strong>Re-acceptance required</strong>' : ''}</p>
      <div class="row">
        <button class="btn secondary" data-act="print-contract">Open accepted / signed copy</button>
        <button class="btn secondary" data-act="accept-contract">Record platform acceptance</button>
      </div>
      <h4>Acceptance history</h4>
      <ul class="muted">${(contract.history || []).map((h) =>
        `<li>${this.esc(h.version_label)} · ${this.esc(h.accepted_at)} · ${this.esc(h.accepted_by_name || '')}
          ${h.has_signature ? ' · signed' : ''}
          <button class="btn secondary" data-print-acc="${this.esc(h.id)}">Open</button></li>`).join('') || '<li>No acceptances</li>'}</ul>
      ` : ''}

      ${this.profileSection === 'docs' ? `
      <h3>Customer Document Centre</h3>
      <table class="table"><thead><tr><th>Document</th><th>Status</th><th></th></tr></thead><tbody>
        <tr><td>Customer Profile</td><td>🟢 Available</td><td><button class="btn secondary" data-profile-sec="overview">Open</button></td></tr>
        <tr><td>Signed T&amp;Cs / Contracts</td><td>${c.documents?.signed_terms ? '🟢 Available' : '🟡 None yet'}</td><td><button class="btn secondary" data-profile-sec="contracts">Open</button></td></tr>
        <tr><td>Contract History</td><td>${c.documents?.contracts ? '🟢 Available' : '🟡 None yet'}</td><td><button class="btn secondary" data-profile-sec="contracts">Open</button></td></tr>
        <tr><td>Subscription Documents</td><td>🟢 Available</td><td><button class="btn secondary" data-profile-sec="package">Open</button></td></tr>
        <tr><td>Activation Records</td><td>${c.documents?.activation ? '🟢 Available' : '🟡 None yet'}</td><td><button class="btn secondary" data-profile-sec="activation">Open</button></td></tr>
        <tr><td>Device Records</td><td>${c.documents?.devices ? '🟢 Available' : '🟡 None yet'}</td><td><button class="btn secondary" data-profile-sec="devices">Open</button></td></tr>
        <tr><td>Invoices / Receipts</td><td>🔒 Not available yet</td><td><span class="muted">—</span></td></tr>
        <tr><td>Uploaded Documents</td><td>🔒 Not available yet</td><td><span class="muted">—</span></td></tr>
        <tr><td>Audit History</td><td>${c.documents?.audit ? '🟢 Available' : '🟡 None yet'}</td><td><button class="btn secondary" data-profile-sec="audit">Open</button></td></tr>
      </tbody></table>
      ` : ''}

      ${this.profileSection === 'fees' ? `
      <h3>Service Fees</h3>
      <div class="row">
        <label><input type="checkbox" id="fee-enabled" ${fee.enabled ? 'checked' : ''}> Enabled</label>
        <select id="fee-type">
          <option value="percent" ${fee.config?.fee_type === 'percent' ? 'selected' : ''}>Percentage</option>
          <option value="fixed" ${fee.config?.fee_type === 'fixed' ? 'selected' : ''}>Fixed</option>
          <option value="percent_plus_fixed" ${fee.config?.fee_type === 'percent_plus_fixed' ? 'selected' : ''}>Percentage + Fixed</option>
        </select>
        <input id="fee-percent" type="number" step="0.01" placeholder="%" style="width:80px" value="${this.esc(fee.config?.percent ?? '')}">
        <input id="fee-fixed" type="number" step="0.01" placeholder="Fixed" style="width:80px" value="${this.esc(fee.config?.fixed_amount ?? '')}">
        <button class="btn secondary" data-act="save-fee">Save Customer Fee</button>
      </div>
      <div class="row" style="margin-top:12px">
        <input id="fee-from" type="date">
        <input id="fee-to" type="date">
        <button class="btn" data-act="load-fee-report">Load fee report</button>
      </div>
      ${feeR ? `<p><strong>Orders:</strong> ${feeR.totals?.order_count ?? 0} ·
        <strong>Sales:</strong> ${this.esc(feeR.totals?.sales_total ?? 0)} ·
        <strong>Service fees:</strong> ${this.esc(feeR.totals?.service_fees_total ?? 0)}</p>` : ''}
      ` : ''}

      ${this.profileSection === 'audit' ? `
      <h3>Audit Log</h3>
      <ul class="muted" style="max-height:320px;overflow:auto">${audit.slice(0, 60).map((a) =>
        `<li>${this.esc(this.formatWhen(a.created_at))} · ${this.esc(a.actor)} · ${this.esc(this.pretty(a.action))}</li>`).join('') || '<li>No audit</li>'}</ul>
      ` : ''}

      ${this.profileSection === 'provision' ? `
      <h3>Provisioning</h3>
      <p class="muted">Creates a dedicated Railway project for this customer. Never touches Chisa Food.</p>
      <div class="row">
        <button class="btn secondary" data-act="provision-dry">Dry Run</button>
        <button class="btn" data-act="provision-run">Provision for Real</button>
        <button class="btn secondary" data-act="shop-health">Health Check</button>
        <button class="btn secondary" data-act="sync-entitlements">Sync Entitlements</button>
      </div>
      ${this.renderProvisionProgress()}
      <h4>Job history</h4>
      <ul class="muted">${(Array.isArray(jobs) ? jobs : []).map((j) =>
        `<li>${this.esc(j.id || j.job_id || '')} · ${this.esc(j.status || '')} · ${this.esc(j.updated_at || j.created_at || '')}</li>`
      ).join('') || '<li>No jobs yet</li>'}</ul>
      ` : ''}
    </div>`;
  },

  // legacy alias
  renderCustomerControl(s) {
    return this.renderCustomerShopControl(s);
  },

  renderProvisionProgress() {
    const stages = [
      { key: 'customer', label: 'Creating Customer' },
      { key: 'project', label: 'Creating Railway Project' },
      { key: 'database', label: 'Creating PostgreSQL' },
      { key: 'env', label: 'Configuring Environment' },
      { key: 'deploy', label: 'Deploying Application' },
      { key: 'health', label: 'Waiting for Health' },
      { key: 'sync', label: 'Synchronizing Entitlements' },
      { key: 'ready', label: 'Customer READY' }
    ];
    const status = String(this.provisionStatus || '').toUpperCase();
    const order = ['PROVISIONING', 'DATABASE_CREATING', 'DEPLOYING', 'HEALTH_CHECK', 'WAITING_HEALTH', 'SYNCING_ENTITLEMENTS', 'READY', 'FAILED'];
    const idx = order.indexOf(status);
    const map = {
      customer: true,
      project: idx >= 0,
      database: idx >= 1 || status === 'READY',
      env: idx >= 2 || status === 'READY',
      deploy: idx >= 2 || status === 'READY',
      health: idx >= 3 || status === 'READY',
      sync: idx >= 5 || status === 'READY',
      ready: status === 'READY'
    };
    if (status === 'FAILED') {
      return `<div class="prov-progress failed">
        <div class="prov-stage bad">FAILED</div>
        <p class="err">${this.esc(this.provisionError || 'Provisioning failed')}</p>
      </div>`;
    }
    if (!status && !this.provisionBusy) {
      return this.provisionPreview
        ? `<details class="advanced-block" open><summary>Dry-Run Plan Summary</summary>
            <pre class="muted" style="white-space:pre-wrap;font-size:0.88rem;margin:0;max-height:200px;overflow:auto">${this.esc(JSON.stringify(this.provisionPreview, null, 2))}</pre>
          </details>`
        : '';
    }
    return `<ul class="prov-progress">${stages.map((st) => {
      const done = map[st.key];
      const current = this.provisionBusy && (
        (st.key === 'project' && status === 'PROVISIONING') ||
        (st.key === 'database' && status === 'DATABASE_CREATING') ||
        (st.key === 'deploy' && status === 'DEPLOYING') ||
        (st.key === 'env' && status === 'DEPLOYING') ||
        (st.key === 'health' && (status === 'HEALTH_CHECK' || status === 'WAITING_HEALTH')) ||
        (st.key === 'sync' && status === 'SYNCING_ENTITLEMENTS')
      );
      return `<li class="${done ? 'done' : ''} ${current ? 'current' : ''}"><span class="mark">${done ? '✓' : (current ? '…' : '○')}</span> ${this.esc(st.label)}</li>`;
    }).join('')}</ul>`;
  },

  renderContracts() {
    const selected = this.selectedContract;
    const list = this.contracts || [];
    return `<div class="grid2">
      <div class="card">
        <h2>Contract versions</h2>
        <p class="muted">Previous versions remain permanently available. Publishing never overwrites accepted history.</p>
        <div class="row" style="margin-bottom:8px">
          <button class="btn" data-act="contract-new-draft">New draft</button>
          <button class="btn secondary" data-act="contract-load-template">Load template</button>
        </div>
        <table class="table"><thead><tr><th>Version</th><th>Status</th><th>Effective</th><th></th></tr></thead><tbody>
          ${list.map((c) => `<tr>
            <td><strong>${this.esc(c.version_label)}</strong><div class="muted">${this.esc(c.title)}</div></td>
            <td>${c.is_active ? '<span class="badge sellable">ACTIVE</span>' : ''}<span class="badge">${this.esc(c.status || '—')}</span></td>
            <td class="muted">${this.esc((c.effective_at || '').slice(0, 10) || '—')}</td>
            <td><button class="btn secondary" data-open-contract="${this.esc(c.id)}">Open</button></td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No contract versions yet</td></tr>'}
        </tbody></table>
      </div>
      <div class="card">
        ${selected ? this.renderContractEditor(selected) : '<h2>Contract editor</h2><p class="muted">Select a version or create a new draft.</p>'}
      </div>
    </div>
    ${selected ? `<div class="card" style="margin-top:16px">
      <h3>Acceptances for ${this.esc(selected.version_label || selected.id)}</h3>
      <ul class="muted">${(this.contractAcceptances || []).map((a) =>
        `<li>${this.esc(a.shop_name || a.shop_id)} · ${this.esc(a.accepted_at)} · ${this.esc(a.accepted_by_name || '')} · ID ${this.esc(a.id)}
          ${a.has_signature ? ' · signed' : ''}</li>`).join('') || '<li>No acceptances for this version yet</li>'}</ul>
    </div>` : ''}`;
  },

  renderContractEditor(c) {
    const isDraft = (c.status || '') === 'draft' && !c.is_active;
    return `<h2>${this.esc(c.version_label)} · ${this.esc(c.title)}</h2>
      <p class="muted">Status: ${this.esc(c.status || '—')} · Re-acceptance: ${c.require_reacceptance ? 'YES' : 'no'}</p>
      <div style="margin:8px 0"><label>Version label</label><input id="cv-label" value="${this.esc(c.version_label || '')}" ${isDraft ? '' : 'readonly'}></div>
      <div style="margin:8px 0"><label>Title</label><input id="cv-title" value="${this.esc(c.title || '')}" ${isDraft ? '' : 'readonly'}></div>
      <div style="margin:8px 0"><label>Effective date</label><input id="cv-effective" type="date" value="${this.esc((c.effective_at || '').slice(0, 10))}"></div>
      <div style="margin:8px 0"><label><input type="checkbox" id="cv-reaccept" ${c.require_reacceptance !== false ? 'checked' : ''}> Require re-acceptance when published</label></div>
      <div style="margin:8px 0"><label>Body (supports {{placeholders}})</label>
        <textarea id="cv-body" rows="14" ${isDraft ? '' : 'readonly'}>${this.esc(c.body_text || '')}</textarea></div>
      <div style="margin:8px 0"><label>Provider placeholders (JSON)</label>
        <textarea id="cv-ph" rows="4">${this.esc(JSON.stringify(c.placeholders || {}, null, 2))}</textarea></div>
      <div class="row">
        ${isDraft ? '<button class="btn" data-act="contract-save-draft">Save draft</button>' : ''}
        ${isDraft ? '<button class="btn" data-act="contract-publish">Publish</button>' : ''}
        <button class="btn secondary" data-act="contract-preview">Preview</button>
        ${!isDraft ? '<button class="btn secondary" data-act="contract-new-from">New version from this</button>' : ''}
      </div>
      <pre id="cv-preview" class="muted" style="white-space:pre-wrap;font-size:12px;max-height:220px;overflow:auto;margin-top:12px"></pre>`;
  },

  renderAssign() {
    const a = this.assignment || { shop_key: 'lab', package_id: '', addon_ids: [], overrides: [], notes: '' };
    const flags = this.entitlementsPreview?.flags || {};
    const flagRows = Object.entries(flags).map(([k, v]) =>
      `<tr><td>${this.esc(k)}</td><td>${v ? '<span class="badge sellable">ON</span>' : '<span class="badge">OFF</span>'}</td></tr>`
    ).join('') || '<tr><td colspan="2" class="muted">No preview</td></tr>';
    return `<div class="grid2">
      <div class="card">
        <h2>Assign package to lab shop</h2>
        <p class="muted">Shop key is fixed to <strong>lab</strong>. Chisa Food keys are rejected by the server.</p>
        <div style="margin:8px 0"><label>Shop key</label><input id="asg-key" value="lab" readonly></div>
        <div style="margin:8px 0"><label>Package</label>
          <select id="asg-pkg">
            <option value="">— none —</option>
            ${this.packages.map((p) => `<option value="${this.esc(p.id)}" ${a.package_id === p.id ? 'selected' : ''}>${this.esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div style="margin:8px 0"><label>Add-ons</label>
          <div class="module-list" style="max-height:180px" id="asg-addons">
            ${this.addons.map((ad) => `<label class="module-item">
              <input type="checkbox" value="${this.esc(ad.id)}" ${(a.addon_ids || []).includes(ad.id) ? 'checked' : ''}>
              <div><strong>${this.esc(ad.name)}</strong><div class="muted">${this.esc(ad.id)}</div></div>
            </label>`).join('') || '<p class="muted">No add-ons</p>'}
          </div>
        </div>
        <div style="margin:8px 0"><label>Notes</label><textarea id="asg-notes">${this.esc(a.notes || '')}</textarea></div>
        <div style="margin:8px 0"><label>Per-shop overrides (JSON array)</label>
          <textarea id="asg-overrides" rows="4" placeholder='[{"module_id":"admin.salesmgmt","enabled":0,"reason":"test"}]'>${this.esc(JSON.stringify(a.overrides || [], null, 2))}</textarea>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="save-asg">Save assignment</button>
          <button class="btn secondary" data-act="refresh-asg">Refresh</button>
        </div>
      </div>
      <div class="card">
        <h2>Effective entitlements (lab)</h2>
        <p class="muted">Enforcement: ${this.entitlementsPreview?.enforcement ? 'ON' : 'OFF'} · Protected prod: ${this.entitlementsPreview?.protected_production ? 'YES' : 'no'}</p>
        <table class="table"><thead><tr><th>Flag</th><th>State</th></tr></thead><tbody>${flagRows}</tbody></table>
        <h3 style="margin-top:16px">Meta</h3>
        <pre class="muted" style="white-space:pre-wrap;font-size:12px">${this.esc(JSON.stringify(this.entitlementsPreview?.meta || {}, null, 2))}</pre>
      </div>
    </div>`;
  },

  modulePicker(selectedIds, prefix) {
    const selected = new Set(selectedIds || []);
    const list = this.filteredModules().filter((m) => m.commercial_class !== 'shared_core' && m.commercial_class !== 'legacy_compat');
    return `<div class="row" style="margin-bottom:8px">
        <div class="grow"><label>Search modules</label><input data-q="${prefix}" value="${this.esc(this.q)}" placeholder="id, name…"></div>
        <div style="min-width:160px"><label>Filter</label>
          <select data-kind="${prefix}">
            <option value="">All sellable</option>
            <option value="major" ${this.filterKind === 'major' ? 'selected' : ''}>Major</option>
            <option value="admin_submodule" ${this.filterKind === 'admin_submodule' ? 'selected' : ''}>Admin sections</option>
            <option value="feature" ${this.filterKind === 'feature' ? 'selected' : ''}>Features</option>
            <option value="dependent" ${this.filterKind === 'dependent' ? 'selected' : ''}>Dependent class</option>
          </select></div>
      </div>
      <div class="module-list" data-picker="${prefix}">
        ${list.map((m) => `<label class="module-item">
          <input type="checkbox" value="${this.esc(m.id)}" ${selected.has(m.id) ? 'checked' : ''}>
          <div><strong>${this.esc(m.name)}</strong> ${this.badge(m.commercial_class)}
            <div class="muted">${this.esc(m.id)}${m.admin_menu ? ' · admin:' + this.esc(m.admin_menu) : ''}</div>
            <div class="muted">${this.esc(m.description || '')}</div>
          </div></label>`).join('') || '<p class="muted">No modules</p>'}
      </div>`;
  },

  selectedFromPicker(prefix) {
    return [...document.querySelectorAll(`[data-picker="${prefix}"] input[type=checkbox]:checked`)].map((el) => el.value);
  },

  renderPackages() {
    const d = this.draft || { name: '', description: '', price: 0, currency: 'ZAR', module_ids: [], is_active: true };
    return `<div class="grid2">
      <div class="card">
        <h2>${d.id ? 'Edit package' : 'Create package'}</h2>
        <p class="muted">Name packages yourself — nothing is hard-coded as the only commercial SKUs.</p>
        <div style="margin:8px 0"><label>Name *</label><input id="pkg-name" value="${this.esc(d.name)}"></div>
        <div style="margin:8px 0"><label>Description</label><textarea id="pkg-desc">${this.esc(d.description)}</textarea></div>
        <div class="row">
          <div class="grow"><label>Price</label><input id="pkg-price" type="number" step="0.01" value="${this.esc(d.price)}"></div>
          <div style="width:100px"><label>Currency</label><input id="pkg-cur" value="${this.esc(d.currency || 'ZAR')}"></div>
        </div>
        <div style="margin:8px 0"><label><input type="checkbox" id="pkg-active" ${d.is_active !== false ? 'checked' : ''}> Active</label></div>
        <h3>Modules &amp; Admin sections</h3>
        ${this.modulePicker(d.module_ids || [], 'pkg')}
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="save-pkg">${d.id ? 'Save changes' : 'Create package'}</button>
          ${d.id ? '<button class="btn secondary" data-act="new-pkg">New</button>' : ''}
          <button class="btn secondary" data-act="validate-pkg">Validate deps</button>
        </div>
        <pre class="err" id="pkg-val"></pre>
      </div>
      <div class="card">
        <h2>Packages (${this.packages.length})</h2>
        <table class="table"><thead><tr><th>Name</th><th>Price</th><th>Modules</th><th></th></tr></thead>
        <tbody>
          ${this.packages.map((p) => `<tr>
            <td><strong>${this.esc(p.name)}</strong><div class="muted">${p.is_active ? 'active' : 'inactive'} · ${this.esc(p.id)}</div>
              <div class="muted">${this.esc(p.description || '')}</div></td>
            <td>${this.esc(p.currency)} ${Number(p.price || 0).toFixed(2)}</td>
            <td><div class="muted">${(p.module_ids || []).map((id) => this.esc(id)).join('<br>') || '—'}</div></td>
            <td>
              <button class="btn secondary" data-edit-pkg="${this.esc(p.id)}">Edit</button>
              <button class="btn secondary" data-toggle-pkg="${this.esc(p.id)}" data-active="${p.is_active ? '0' : '1'}">${p.is_active ? 'Deactivate' : 'Activate'}</button>
              <button class="btn danger" data-del-pkg="${this.esc(p.id)}">Delete</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="4" class="muted">No packages yet</td></tr>'}
        </tbody></table>
      </div>
    </div>`;
  },

  renderAddons() {
    const d = this.addonDraft || { name: '', description: '', price: 0, currency: 'ZAR', module_ids: [], is_active: true };
    return `<div class="grid2">
      <div class="card">
        <h2>${d.id ? 'Edit add-on' : 'Create add-on'}</h2>
        <p class="muted">Sell modules separately from packages, then assign to shops later (Phase 4+).</p>
        <div style="margin:8px 0"><label>Name *</label><input id="ad-name" value="${this.esc(d.name)}"></div>
        <div style="margin:8px 0"><label>Description</label><textarea id="ad-desc">${this.esc(d.description)}</textarea></div>
        <div class="row">
          <div class="grow"><label>Price</label><input id="ad-price" type="number" step="0.01" value="${this.esc(d.price)}"></div>
          <div style="width:100px"><label>Currency</label><input id="ad-cur" value="${this.esc(d.currency || 'ZAR')}"></div>
        </div>
        ${this.modulePicker(d.module_ids || [], 'ad')}
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="save-ad">${d.id ? 'Save add-on' : 'Create add-on'}</button>
          ${d.id ? '<button class="btn secondary" data-act="new-ad">New</button>' : ''}
        </div>
      </div>
      <div class="card">
        <h2>Add-ons (${this.addons.length})</h2>
        <table class="table"><thead><tr><th>Name</th><th>Modules</th><th></th></tr></thead>
        <tbody>
          ${this.addons.map((a) => `<tr>
            <td><strong>${this.esc(a.name)}</strong><div class="muted">${this.esc(a.currency)} ${Number(a.price || 0).toFixed(2)}</div></td>
            <td class="muted">${(a.module_ids || []).map((id) => this.esc(id)).join('<br>')}</td>
            <td>
              <button class="btn secondary" data-edit-ad="${this.esc(a.id)}">Edit</button>
              <button class="btn danger" data-del-ad="${this.esc(a.id)}">Delete</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="3" class="muted">No add-ons yet</td></tr>'}
        </tbody></table>
      </div>
    </div>`;
  },

  renderModules() {
    const sellable = this.modules.filter((m) => m.commercial_class !== 'shared_core');
    const core = this.modules.filter((m) => m.commercial_class === 'shared_core');
    return `<div class="card">
      <h2>Module catalog (${this.modules.length})</h2>
      <p class="muted">Source of truth: MODULE-CATALOG.json. Sync refreshes this list.</p>
      <div class="row" style="margin-bottom:12px">
        <div class="grow"><input data-q="mod" value="${this.esc(this.q)}" placeholder="Filter…"></div>
        <select data-kind="mod">
          <option value="">All</option>
          <option value="major">Major</option>
          <option value="admin_submodule">Admin</option>
          <option value="feature">Feature</option>
          <option value="shared_core">Shared core</option>
        </select>
      </div>
      <h3>Sellable / controllable (${sellable.length})</h3>
      <div class="module-list" style="max-height:320px">
        ${this.filteredModules().filter((m) => m.commercial_class !== 'shared_core').map((m) => `
          <div class="module-item"><div>
            <strong>${this.esc(m.name)}</strong> ${this.badge(m.commercial_class)}
            <div class="muted">${this.esc(m.id)} · deps: ${(m.dependencies || []).map((d) => this.esc(d)).join(', ') || '—'}</div>
          </div></div>`).join('')}
      </div>
      <h3 style="margin-top:16px">Shared core (not sold alone) (${core.length})</h3>
      <div class="module-list" style="max-height:200px">
        ${core.map((m) => `<div class="module-item"><div><strong>${this.esc(m.name)}</strong> ${this.badge('shared_core')}
          <div class="muted">${this.esc(m.id)}</div></div></div>`).join('')}
      </div>
    </div>`;
  },

  bind() {
    const root = document.getElementById('app');
    root.querySelector('[data-act="login"]')?.addEventListener('click', async () => {
      try {
        const r = await PlatformAPI.login(document.getElementById('pf-user').value.trim(), document.getElementById('pf-pass').value);
        localStorage.setItem('platform_token', r.token);
        this.user = r.user;
        this.view = 'app';
        this.shellReady = true;
        this.error = '';
        this.message = '';
        this.render(); // shell visible immediately
        const t0 = performance.now();
        await this.ensureTabData(this.tab || 'applications', { force: true });
        this.persistCache();
        this.warmCatalog();
        this.bootMs = Math.round(performance.now() - t0);
        this.render();
      } catch (e) {
        const err = document.getElementById('pf-err');
        if (err) err.textContent = e.message;
      }
    });
    root.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', async () => {
      const next = btn.getAttribute('data-tab');
      if (!next) return;
      this.tab = next;
      this.error = '';
      this.message = '';
      try {
        // Paint chrome even if section body throws — then load data and re-render
        try { this.render(); } catch (re) { this.error = re.message || String(re); }
        await this.ensureTabData(this.tab, { force: true });
        this.error = '';
        this.persistCache();
        this.render();
      } catch (e) {
        this.error = e.message || String(e);
        try { this.render(); } catch (_) { /* keep prior DOM */ }
      }
    }));
    root.querySelector('[data-act="logout"]')?.addEventListener('click', async () => {
      try { await PlatformAPI.logout(); } catch (_) { /* */ }
      localStorage.removeItem('platform_token');
      this.view = 'login';
      this.render();
    });
    root.querySelector('[data-act="sync"]')?.addEventListener('click', async () => {
      try {
        const r = await PlatformAPI.syncCatalog();
        await this.loadAll();
        this.message = `Zenco catalog synced (${r.upserted || 0} modules) — open Modules / Packages to browse`;
        this.error = '';
        this.tab = 'modules';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="samples"]')?.addEventListener('click', async () => {
      try {
        await PlatformAPI.bootstrapLabSamples();
        await this.loadAll();
        this.tab = 'packages';
        this.message = 'Lab Samples loaded — sample packages and add-ons are ready to edit';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="lab-customers"]')?.addEventListener('click', async () => {
      try {
        await PlatformAPI.bootstrapLabCustomers();
        this.invalidateTab('shops');
        this.tab = 'shops';
        this.error = '';
        this.message = 'Lab customers ready';
        this.render();
        await this.ensureTabData('shops', { force: true });
        this.message = `Lab customers list ready (${this.shops.length} shown)`;
        this.render();
      } catch (e) {
        // Still navigate to customers even if seed fails (e.g. already exist)
        this.tab = 'shops';
        this.error = e.message;
        try {
          await this.ensureTabData('shops', { force: true });
        } catch (_) { /* */ }
        this.render();
      }
    });

    // ── Customer Applications ──
    root.querySelector('[data-act="app-refresh"]')?.addEventListener('click', async () => {
      this.appFilter = document.getElementById('app-q')?.value || '';
      this.appStatusFilter = document.getElementById('app-status-f')?.value || '';
      try {
        await this.loadAll();
        if (this.selectedApplication?.id) {
          this.selectedApplication = await PlatformAPI.getApplication(this.selectedApplication.id);
        }
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelectorAll('[data-app-id]').forEach((tr) => tr.addEventListener('click', async () => {
      try {
        this.selectedApplication = await PlatformAPI.getApplication(tr.getAttribute('data-app-id'));
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    const appNotes = () => document.getElementById('app-notes')?.value?.trim() || '';
    root.querySelector('[data-act="app-under-review"]')?.addEventListener('click', async () => {
      if (!this.selectedApplication) return;
      this.appBusy = true; this.render();
      try {
        this.selectedApplication = await PlatformAPI.setApplicationStatus(
          this.selectedApplication.id, 'UNDER_REVIEW', { admin_notes: appNotes() });
        await this.loadAll();
        this.message = `Application ${this.selectedApplication.reference} → UNDER REVIEW`;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.appBusy = false; this.render();
    });
    root.querySelector('[data-act="app-more-info"]')?.addEventListener('click', async () => {
      if (!this.selectedApplication) return;
      const info = await this.prompt('What additional information is required from the applicant?', {
        title: 'Request More Information',
        value: this.selectedApplication.info_request || '',
        multiline: true,
        okLabel: 'Send Request'
      });
      if (info == null) return;
      this.appBusy = true; this.render();
      try {
        this.selectedApplication = await PlatformAPI.setApplicationStatus(
          this.selectedApplication.id, 'MORE_INFORMATION_REQUIRED', {
            info_request: info,
            admin_notes: appNotes()
          });
        await this.loadAll();
        this.message = `Requested more information for ${this.selectedApplication.reference}`;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.appBusy = false; this.render();
    });
    root.querySelector('[data-act="app-reject"]')?.addEventListener('click', async () => {
      if (!this.selectedApplication) return;
      const reason = await this.prompt('Please enter a rejection reason.', {
        title: 'Reject Application',
        value: this.selectedApplication.rejected_reason || '',
        multiline: true,
        okLabel: 'Continue'
      });
      if (reason == null) return;
      if (!String(reason).trim()) { this.error = 'Rejection reason is required'; this.render(); return; }
      if (!await this.confirm('Reject this application? No shop, Railway, or activation will be created.', {
        title: 'Confirm Rejection', okLabel: 'Reject', danger: true
      })) return;
      this.appBusy = true; this.render();
      try {
        this.selectedApplication = await PlatformAPI.setApplicationStatus(
          this.selectedApplication.id, 'REJECTED', {
            rejected_reason: String(reason).trim(),
            admin_notes: appNotes()
          });
        await this.loadAll();
        this.message = `Application ${this.selectedApplication.reference} rejected`;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.appBusy = false; this.render();
    });
    root.querySelector('[data-act="app-approve"]')?.addEventListener('click', async () => {
      if (!this.selectedApplication) return;
      const pkgOverride = document.getElementById('app-pkg-override')?.value || null;
      if (!this.selectedApplication.package_id && !pkgOverride) {
        this.error = 'Select a package before approval.';
        this.render();
        return;
      }
      if (!await this.confirm(
        'Approve this application?\n\nThis will:\n• Create the customer/shop record\n• Start Railway provisioning\n• Sync entitlements\n• Generate an activation link\n\nOnly do this for real approved customers.',
        { title: 'Approve Application', okLabel: 'Approve & Provision' }
      )) return;
      this.appBusy = true;
      this.message = 'Approving — provisioning may take several minutes…';
      this.error = '';
      this.render();
      try {
        const r = await PlatformAPI.approveApplication(this.selectedApplication.id, {
          admin_notes: appNotes(),
          package_id: pkgOverride || undefined
        });
        this.selectedApplication = r.application || await PlatformAPI.getApplication(this.selectedApplication.id);
        await this.loadAll();
        const parts = [`Approved ${this.selectedApplication.reference}`];
        if (r.shop_id) parts.push(`shop ${r.shop_id}`);
        if (r.provision_error) parts.push(`provision: ${r.provision_error}`);
        else if (r.provision?.status || r.provision?.job_id) parts.push('provision started');
        if (r.activation_error) parts.push(`activation: ${r.activation_error}`);
        else if (this.selectedApplication.activation_link) parts.push('activation link ready');
        this.message = parts.join(' · ');
        this.error = r.provision_error || r.activation_error || '';
        if (r.shop_id) {
          try { this.selectedShop = await PlatformAPI.getShop(r.shop_id); } catch (_) { /* */ }
        }
      } catch (e) { this.error = e.message; }
      this.appBusy = false; this.render();
    });

    root.querySelector('[data-act="create-shop"]')?.addEventListener('click', async () => {
      try {
        const payload = this.collectCustomerForm();
        if (!payload.shop_name || !payload.owner_name || !payload.owner_email || !payload.package_id) {
          throw new Error('Shop name, owner name, email, and package are required');
        }
        const r = await PlatformAPI.createShop(payload);
        await this.loadAll();
        this.editingShopId = null;
        this.selectedShop = await PlatformAPI.getShop(r.id || r.data?.id);
        this.message = 'Customer created — next: Provision for real';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="save-shop-edit"]')?.addEventListener('click', async () => {
      try {
        const id = this.editingShopId || document.getElementById('sh-edit-id')?.value;
        if (!id) throw new Error('No shop selected for edit');
        const payload = this.collectCustomerForm();
        if (!payload.shop_name || !payload.owner_name || !payload.owner_email) {
          throw new Error('Shop name, owner name, and email are required');
        }
        await PlatformAPI.updateShop(id, payload);
        if (payload.package_id) {
          await PlatformAPI.assignShop(id, {
            package_id: payload.package_id,
            addon_ids: payload.addon_ids || []
          });
        }
        if (payload.subscription_status) {
          await PlatformAPI.setShopStatus(id, payload.subscription_status);
        }
        await this.loadAll();
        this.selectedShop = await PlatformAPI.getShop(id);
        this.editingShopId = null;
        this.message = 'Customer updated';
        this.error = '';
        this.render();
      } catch (e) {
        this.error = e.message;
        this.render();
        if (this.editingShopId && this.selectedShop) this.fillCustomerForm(this.selectedShop);
      }
    });
    root.querySelector('[data-act="cancel-shop-edit"]')?.addEventListener('click', () => {
      this.editingShopId = null;
      this.message = 'Edit cancelled';
      this.error = '';
      this.render();
    });
    root.querySelector('[data-act="filter-shops"]')?.addEventListener('click', async () => {
      this.shopFilter = document.getElementById('sh-filter')?.value || '';
      this.shopStatusFilter = document.getElementById('sh-status-filter')?.value || '';
      await this.loadAll();
      this.render();
    });
    root.querySelectorAll('[data-open-shop]').forEach((btn) => btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await this.openCustomerShopControl(btn.getAttribute('data-open-shop'));
      } catch (e) { /* error already shown */ }
    }));
    root.querySelectorAll('[data-open-shop-row]').forEach((row) => row.addEventListener('click', async () => {
      try {
        await this.openCustomerShopControl(row.getAttribute('data-open-shop-row'));
      } catch (e) { /* error already shown */ }
    }));
    root.querySelector('[data-act="close-shop-control"]')?.addEventListener('click', () => {
      this.selectedShop = null;
      this.control = null;
      this.lastActivation = null;
      this.feeReport = null;
      this.shopHealthPreview = null;
      this.profileSection = 'overview';
      this.message = '';
      this.error = '';
      this.render();
    });
    root.querySelector('[data-act="suspend-customer"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        if (!id) return;
        if (!await this.confirm('Suspend this customer? Access will be gated until reactivated.', {
          title: 'Suspend Customer', okLabel: 'Suspend', danger: true
        })) return;
        await PlatformAPI.setShopStatus(id, 'SUSPENDED');
        this.selectedShop = await PlatformAPI.getShop(id);
        this.control = await PlatformAPI.customerControl(id);
        await this.loadAll();
        this.message = 'Customer suspended';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="reactivate-customer"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        if (!id) return;
        await PlatformAPI.setShopStatus(id, 'ACTIVE');
        this.selectedShop = await PlatformAPI.getShop(id);
        this.control = await PlatformAPI.customerControl(id);
        await this.loadAll();
        this.message = 'Customer reactivated';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelectorAll('[data-edit-shop]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await this.beginEditShop(btn.getAttribute('data-edit-shop'));
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelectorAll('[data-delete-shop]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await this.deleteShopFlow(btn.getAttribute('data-delete-shop'));
      } catch (e) { this.error = e.message; this.render(); }
    }));
    if (this.editingShopId && this.selectedShop?.id === this.editingShopId) {
      this.fillCustomerForm(this.selectedShop);
    }
    root.querySelector('[data-act="save-shop-assign"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        const addon_ids = [...document.querySelectorAll('#det-addons input:checked')].map((el) => el.value);
        const btn = root.querySelector('[data-act="save-shop-assign"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        await PlatformAPI.assignShop(id, {
          package_id: document.getElementById('det-pkg').value || null,
          addon_ids
        });
        let syncMsg = 'Package/add-ons saved on Platform.';
        try {
          if (btn) btn.textContent = 'Syncing to shop…';
          const r = await PlatformAPI.syncCustomerEntitlements(id);
          if (r?.ok) syncMsg = 'Package updated and synced to customer shop. Ask them to refresh (or switch tabs) to unlock modules.';
          else if (r?.skipped || r?.reason) syncMsg = `Package saved. Sync: ${r.reason || r.error || 'skipped'} — use Sync entitlements if needed.`;
          else if (r?.error) syncMsg = `Package saved. Sync failed: ${r.error} — use Sync entitlements.`;
          this.provisionPreview = r;
        } catch (syncErr) {
          syncMsg = `Package saved on Platform. Customer sync error: ${syncErr.message || syncErr} — use Sync entitlements.`;
        }
        this.selectedShop = await PlatformAPI.getShop(id);
        await this.loadAll();
        this.message = syncMsg;
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="save-shop-status"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        await PlatformAPI.setShopStatus(id, document.getElementById('det-status').value);
        let syncMsg = 'Subscription status updated';
        try {
          const r = await PlatformAPI.syncCustomerEntitlements(id);
          if (r?.ok) syncMsg = 'Status updated and synced to customer shop';
          else if (r?.reason || r?.error) syncMsg = `Status updated. Sync: ${r.reason || r.error}`;
          this.provisionPreview = r;
        } catch (_) { /* keep status message */ }
        this.selectedShop = await PlatformAPI.getShop(id);
        await this.loadAll();
        this.message = syncMsg;
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    const reloadControl = async () => {
      const id = this.selectedShop?.id;
      const raw = await PlatformAPI.customerControl(id);
      this.control = this.normalizeCustomerControl(raw, id);
      this.render();
    };
    root.querySelectorAll('[data-profile-sec]').forEach((btn) => btn.addEventListener('click', () => {
      this.profileSection = btn.getAttribute('data-profile-sec');
      this.render();
    }));
    root.querySelectorAll('[data-open-contract]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        this.selectedContract = await PlatformAPI.getContractVersion(btn.getAttribute('data-open-contract'));
        let acc = await PlatformAPI.listContractAcceptances({ contract_version_id: this.selectedContract.id });
        this.contractAcceptances = Array.isArray(acc) ? acc : (acc?.data || []);
        this.tab = 'contracts';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelector('[data-act="contract-new-draft"]')?.addEventListener('click', async () => {
      try {
        const tpl = await PlatformAPI.contractTemplate().catch(() => null);
        this.selectedContract = await PlatformAPI.createContractVersion({
          version_label: `v${(this.contracts.length || 0) + 1}.0-draft`,
          title: tpl?.title || 'SaaS Customer Service Agreement',
          body_text: tpl?.body_text || '',
          placeholders: tpl?.placeholders || {},
          draft: true,
          activate: false,
          publish: false
        });
        await this.loadAll();
        this.tab = 'contracts';
        this.message = 'Draft contract created';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="contract-load-template"]')?.addEventListener('click', async () => {
      try {
        const tpl = await PlatformAPI.contractTemplate();
        if (document.getElementById('cv-body')) document.getElementById('cv-body').value = tpl.body_text || '';
        if (document.getElementById('cv-title')) document.getElementById('cv-title').value = tpl.title || '';
        if (document.getElementById('cv-ph')) document.getElementById('cv-ph').value = JSON.stringify(tpl.placeholders || {}, null, 2);
        this.message = 'Template loaded into editor fields';
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="contract-save-draft"]')?.addEventListener('click', async () => {
      try {
        let placeholders = {};
        try { placeholders = JSON.parse(document.getElementById('cv-ph')?.value || '{}'); } catch (_) { throw new Error('Placeholders must be valid JSON'); }
        this.selectedContract = await PlatformAPI.updateDraftContract(this.selectedContract.id, {
          version_label: document.getElementById('cv-label')?.value,
          title: document.getElementById('cv-title')?.value,
          body_text: document.getElementById('cv-body')?.value,
          effective_at: document.getElementById('cv-effective')?.value || null,
          require_reacceptance: !!document.getElementById('cv-reaccept')?.checked,
          placeholders
        });
        await this.loadAll();
        this.message = 'Draft saved';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="contract-publish"]')?.addEventListener('click', async () => {
      try {
        if (!await this.confirm('Publish this contract version? Prior versions remain available.', {
          title: 'Publish Contract', okLabel: 'Publish'
        })) return;
        let placeholders = {};
        try { placeholders = JSON.parse(document.getElementById('cv-ph')?.value || '{}'); } catch (_) { placeholders = {}; }
        await PlatformAPI.updateDraftContract(this.selectedContract.id, {
          version_label: document.getElementById('cv-label')?.value,
          title: document.getElementById('cv-title')?.value,
          body_text: document.getElementById('cv-body')?.value,
          effective_at: document.getElementById('cv-effective')?.value || null,
          require_reacceptance: !!document.getElementById('cv-reaccept')?.checked,
          placeholders
        }).catch(() => {});
        this.selectedContract = await PlatformAPI.publishContract(this.selectedContract.id, {
          require_reacceptance: !!document.getElementById('cv-reaccept')?.checked,
          effective_at: document.getElementById('cv-effective')?.value || null
        });
        await this.loadAll();
        this.message = 'Contract published' + (this.selectedContract.require_reacceptance ? ' — customers may need re-acceptance' : '');
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="contract-preview"]')?.addEventListener('click', async () => {
      try {
        const prev = await PlatformAPI.previewContract(this.selectedContract.id, this.selectedShop?.id || null);
        const el = document.getElementById('cv-preview');
        if (el) el.textContent = prev.body_text || '';
        this.message = 'Preview rendered';
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="contract-new-from"]')?.addEventListener('click', async () => {
      try {
        const src = this.selectedContract;
        this.selectedContract = await PlatformAPI.createContractVersion({
          version_label: `${src.version_label || 'v'}-next`,
          title: src.title,
          body_text: src.body_text,
          placeholders: src.placeholders,
          draft: true,
          activate: false,
          publish: false,
          require_reacceptance: true
        });
        await this.loadAll();
        this.message = 'New draft created from previous version';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="load-fee-report"]')?.addEventListener('click', async () => {
      try {
        this.feeReport = await PlatformAPI.shopFeeReport(this.selectedShop.id, {
          from: document.getElementById('fee-from')?.value || null,
          to: document.getElementById('fee-to')?.value || null,
          limit: 50
        });
        this.profileSection = 'fees';
        this.message = 'Fee report loaded';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelectorAll('[data-print-acc]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        const doc = await PlatformAPI.printContract(this.selectedShop.id, btn.getAttribute('data-print-acc'));
        this.openSignedContractWindow(doc);
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelector('[data-act="load-control"]')?.addEventListener('click', async () => {
      try {
        if (!this.selectedShop?.id) throw new Error('Select a customer first');
        await this.openCustomerShopControl(this.selectedShop.id);
      } catch (e) { /* shown */ }
    });
    root.querySelector('[data-act="accept-contract"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        await PlatformAPI.acceptContract(id, {
          accepted_by_name: this.selectedShop.owner_name,
          accepted_by_email: this.selectedShop.owner_email,
          require_signature: false
        });
        await reloadControl();
        this.message = 'Contract acceptance recorded';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="print-contract"]')?.addEventListener('click', async () => {
      try {
        const doc = await PlatformAPI.printContract(this.selectedShop.id);
        this.openSignedContractWindow(doc);
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="new-contract"]')?.addEventListener('click', async () => {
      this.tab = 'contracts';
      this.render();
    });
    root.querySelector('[data-act="gen-activation"]')?.addEventListener('click', async () => {
      try {
        const created = await PlatformAPI.createActivation(this.selectedShop.id, { expires_hours: 72 });
        this.lastActivation = created?.data || created;
        if (!this.lastActivation.activation_link && this.selectedShop.shop_url && this.lastActivation.link_token) {
          this.lastActivation.activation_link = `${String(this.selectedShop.shop_url).replace(/\/$/, '')}/activate?token=${encodeURIComponent(this.lastActivation.link_token)}&shop=${encodeURIComponent(this.selectedShop.id)}`;
        }
        const bundle = this.lastActivation.customer_bundle;
        await reloadControl();
        if (bundle && bundle.ok === false && !bundle.skipped) {
          this.message = 'Activation link generated, but customer sync failed — open the link after retrying Generate, or check shop health';
          this.error = bundle.reason || 'Customer activation bundle push failed';
        } else {
          this.message = 'Activation link generated — copy and send to the customer';
          this.error = '';
        }
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="regen-activation"]')?.addEventListener('click', async () => {
      try {
        const created = await PlatformAPI.regenerateActivation(this.selectedShop.id, { expires_hours: 72 });
        this.lastActivation = created?.data || created;
        if (!this.lastActivation.activation_link && this.selectedShop.shop_url && this.lastActivation.link_token) {
          this.lastActivation.activation_link = `${String(this.selectedShop.shop_url).replace(/\/$/, '')}/activate?token=${encodeURIComponent(this.lastActivation.link_token)}&shop=${encodeURIComponent(this.selectedShop.id)}`;
        }
        const bundle = this.lastActivation.customer_bundle;
        await reloadControl();
        if (bundle && bundle.ok === false && !bundle.skipped) {
          this.message = 'Activation regenerated, but customer sync failed';
          this.error = bundle.reason || 'Customer activation bundle push failed';
        } else {
          this.message = 'Activation regenerated; previous codes revoked';
          this.error = '';
        }
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="copy-activation"]')?.addEventListener('click', async () => {
      const link = document.getElementById('act-link')?.value || this.lastActivation?.activation_link || '';
      if (!link || link.startsWith('(')) {
        this.error = 'No complete activation URL available yet (customer must be provisioned with a shop URL)';
        this.render();
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        this.message = 'Activation link copied';
        this.error = '';
        this.render();
      } catch (_) {
        document.getElementById('act-link')?.select();
        this.message = 'Select the URL and copy manually (clipboard blocked)';
        this.render();
      }
    });
    root.querySelectorAll('[data-revoke-act]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await PlatformAPI.revokeActivation(btn.getAttribute('data-revoke-act'));
        this.lastActivation = null;
        await reloadControl();
        this.message = 'Activation revoked';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelectorAll('[data-revoke-dev]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await PlatformAPI.revokeDevice(btn.getAttribute('data-revoke-dev'));
        await reloadControl();
        this.message = 'Device revoked';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelector('[data-act="save-fee"]')?.addEventListener('click', async () => {
      try {
        await PlatformAPI.upsertServiceFee({
          scope: 'customer',
          scope_id: this.selectedShop.id,
          enabled: !!document.getElementById('fee-enabled')?.checked,
          fee_type: document.getElementById('fee-type').value,
          percent: Number(document.getElementById('fee-percent').value) || 0,
          fixed_amount: Number(document.getElementById('fee-fixed').value) || 0
        });
        await reloadControl();
        this.message = 'Customer service fee saved';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="save-shop-overrides"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        const overrides = JSON.parse(document.getElementById('det-overrides').value || '[]');
        if (!Array.isArray(overrides)) throw new Error('overrides must be an array');
        await PlatformAPI.setShopOverrides(id, overrides);
        this.selectedShop = await PlatformAPI.getShop(id);
        this.message = 'Overrides saved (audit logged)';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="provision-dry"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        const r = await PlatformAPI.provisionDryRun(id);
        this.provisionPreview = r.plan || r;
        this.message = 'Dry-run complete — nothing created on Railway';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="provision-run"]')?.addEventListener('click', async () => {
      if (!await this.confirm('Create a new Railway project, Postgres, and app for this shop? This will not touch Chisa Food.', {
        title: 'Provision Customer', okLabel: 'Provision', danger: true
      })) return;
      const id = this.selectedShop?.id;
      this.provisionBusy = true;
      this.provisionFailed = false;
      this.provisionError = '';
      this.provisionStatus = 'PROVISIONING';
      this.message = 'Provisioning in progress…';
      this.error = '';
      this.render();
      const poll = async () => {
        try {
          const jobs = await PlatformAPI.provisionJobs(id);
          const list = Array.isArray(jobs) ? jobs : (jobs?.data || jobs?.jobs || []);
          const latest = list[0];
          if (latest?.status) {
            this.provisionStatus = latest.status;
            if (latest.error_safe) this.provisionError = latest.error_safe;
            this.render();
          }
        } catch (_) { /* ignore poll errors */ }
      };
      if (this.provisionPollTimer) clearInterval(this.provisionPollTimer);
      this.provisionPollTimer = setInterval(poll, 2500);
      poll();
      try {
        const r = await PlatformAPI.provisionRun(id);
        clearInterval(this.provisionPollTimer);
        this.provisionPollTimer = null;
        this.provisionBusy = false;
        this.provisionPreview = r;
        this.provisionStatus = r.status || r.data?.status || '';
        this.selectedShop = await PlatformAPI.getShop(id);
        await this.loadAll();
        if (this.provisionStatus === 'READY') {
          this.provisionFailed = false;
          this.message = 'Customer READY';
          this.error = '';
        } else if (this.provisionStatus === 'FAILED') {
          this.provisionFailed = true;
          this.provisionError = r.error_safe || r.error || r.data?.error_safe || 'Provisioning failed';
          this.message = '';
          this.error = this.provisionError;
        } else {
          this.message = 'Provision finished: ' + (this.provisionStatus || 'done');
        }
        this.render();
      } catch (e) {
        clearInterval(this.provisionPollTimer);
        this.provisionPollTimer = null;
        this.provisionBusy = false;
        this.provisionFailed = true;
        this.provisionStatus = 'FAILED';
        this.provisionError = e.message || 'Provisioning failed';
        this.error = this.provisionError;
        this.render();
      }
    });
    root.querySelector('[data-act="shop-health"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        this.shopHealthPreview = await PlatformAPI.shopHealth(id);
        this.provisionPreview = this.shopHealthPreview;
        this.message = this.shopHealthPreview.ok ? 'Customer healthy' : 'Customer health issues — see detail';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="sync-entitlements"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        const r = await PlatformAPI.syncCustomerEntitlements(id);
        this.provisionPreview = r;
        this.message = r.ok ? 'Entitlements synced to customer' : ('Sync skipped/failed: ' + (r.reason || r.error || 'unknown'));
        this.error = r.ok ? '' : (r.error || r.reason || 'sync failed');
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="save-asg"]')?.addEventListener('click', async () => {
      let overrides = [];
      try {
        overrides = JSON.parse(document.getElementById('asg-overrides').value || '[]');
        if (!Array.isArray(overrides)) throw new Error('overrides must be an array');
      } catch (e) {
        this.error = 'Invalid overrides JSON: ' + e.message;
        this.render();
        return;
      }
      const addon_ids = [...document.querySelectorAll('#asg-addons input[type=checkbox]:checked')].map((el) => el.value);
      try {
        const r = await PlatformAPI.saveShopAssignment({
          shop_key: 'lab',
          package_id: document.getElementById('asg-pkg').value || null,
          addon_ids,
          overrides,
          notes: document.getElementById('asg-notes').value
        });
        this.assignment = r.data || r;
        this.entitlementsPreview = this.assignment?.entitlements || null;
        this.message = 'Lab assignment saved (audit logged)';
        this.error = '';
        this.render();
      } catch (e) {
        this.error = e.message;
        this.render();
      }
    });
    root.querySelector('[data-act="refresh-asg"]')?.addEventListener('click', async () => {
      try {
        await this.loadAll();
        this.message = 'Assignment refreshed';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelectorAll('[data-q]').forEach((inp) => inp.addEventListener('change', () => {
      this.q = inp.value;
      this.render();
    }));
    root.querySelectorAll('[data-kind]').forEach((sel) => sel.addEventListener('change', () => {
      this.filterKind = sel.value;
      this.render();
    }));
    root.querySelector('[data-act="new-pkg"]')?.addEventListener('click', () => { this.draft = null; this.render(); });
    root.querySelector('[data-act="new-ad"]')?.addEventListener('click', () => { this.addonDraft = null; this.render(); });
    root.querySelector('[data-act="validate-pkg"]')?.addEventListener('click', async () => {
      const ids = this.selectedFromPicker('pkg');
      try {
        const r = await PlatformAPI.validateModules(ids);
        const box = document.getElementById('pkg-val');
        if (box) box.textContent = (r.ok ? 'OK' : 'FAILED') + '\n' + (r.errors || []).join('\n') + '\n' + (r.warnings || []).join('\n');
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="save-pkg"]')?.addEventListener('click', async () => {
      const payload = {
        id: this.draft?.id,
        name: document.getElementById('pkg-name').value.trim(),
        description: document.getElementById('pkg-desc').value,
        price: Number(document.getElementById('pkg-price').value || 0),
        currency: document.getElementById('pkg-cur').value.trim() || 'ZAR',
        is_active: document.getElementById('pkg-active').checked,
        module_ids: this.selectedFromPicker('pkg')
      };
      try {
        const r = await PlatformAPI.savePackage(payload);
        this.draft = r.data;
        await this.loadAll();
        this.message = 'Package saved';
        this.error = '';
        this.render();
      } catch (e) {
        this.error = e.message;
        this.render();
      }
    });
    root.querySelector('[data-act="save-ad"]')?.addEventListener('click', async () => {
      const payload = {
        id: this.addonDraft?.id,
        name: document.getElementById('ad-name').value.trim(),
        description: document.getElementById('ad-desc').value,
        price: Number(document.getElementById('ad-price').value || 0),
        currency: document.getElementById('ad-cur').value.trim() || 'ZAR',
        is_active: true,
        module_ids: this.selectedFromPicker('ad')
      };
      try {
        const r = await PlatformAPI.saveAddon(payload);
        this.addonDraft = r.data;
        await this.loadAll();
        this.message = 'Add-on saved';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelectorAll('[data-edit-pkg]').forEach((btn) => btn.addEventListener('click', () => {
      const p = this.packages.find((x) => x.id === btn.getAttribute('data-edit-pkg'));
      this.draft = p ? { ...p } : null;
      this.render();
    }));
    root.querySelectorAll('[data-toggle-pkg]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await PlatformAPI.setPackageActive(btn.getAttribute('data-toggle-pkg'), btn.getAttribute('data-active') === '1');
        await this.loadAll();
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelectorAll('[data-del-pkg]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!await this.confirm('Delete this package? This cannot be undone.', {
        title: 'Delete Package', okLabel: 'Delete', danger: true
      })) return;
      try {
        await PlatformAPI.deletePackage(btn.getAttribute('data-del-pkg'));
        this.draft = null;
        await this.loadAll();
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelectorAll('[data-edit-ad]').forEach((btn) => btn.addEventListener('click', () => {
      const a = this.addons.find((x) => x.id === btn.getAttribute('data-edit-ad'));
      this.addonDraft = a ? { ...a } : null;
      this.render();
    }));
    root.querySelectorAll('[data-del-ad]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!await this.confirm('Delete this add-on? This cannot be undone.', {
        title: 'Delete Add-on', okLabel: 'Delete', danger: true
      })) return;
      try {
        await PlatformAPI.deleteAddon(btn.getAttribute('data-del-ad'));
        this.addonDraft = null;
        await this.loadAll();
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
  }
};

// Defer-safe boot (scripts may load with defer)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => PlatformApp.init());
} else {
  PlatformApp.init();
}
window.PlatformApp = PlatformApp;
