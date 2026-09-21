const PlatformApp = {
  view: 'login',
  tab: 'shops',
  user: null,
  modules: [],
  packages: [],
  addons: [],
  shops: [],
  selectedShop: null,
  provisionPreview: null,
  shopHealthPreview: null,
  shopFilter: '',
  shopStatusFilter: '',
  assignment: null,
  entitlementsPreview: null,
  filterKind: '',
  q: '',
  draft: null,
  addonDraft: null,
  message: '',
  error: '',

  async init() {
    try {
      const st = await PlatformAPI.status();
      if (!st.enabled) {
        this.view = 'disabled';
        this.render();
        return;
      }
    } catch (e) {
      this.view = 'disabled';
      this.error = e.message;
      this.render();
      return;
    }
    if (localStorage.getItem('platform_token')) {
      try {
        await this.loadAll();
        this.view = 'app';
      } catch (_) {
        localStorage.removeItem('platform_token');
      }
    }
    this.render();
  },

  async loadAll() {
    const [mods, pkgs, adds] = await Promise.all([
      PlatformAPI.listModules({}),
      PlatformAPI.listPackages(),
      PlatformAPI.listAddons()
    ]);
    this.modules = mods.data || mods || [];
    this.packages = pkgs.data || pkgs || [];
    this.addons = adds.data || adds || [];
    try {
      const list = await PlatformAPI.listShops({ q: this.shopFilter, subscription_status: this.shopStatusFilter || undefined });
      this.shops = list.shops || list.data || list || [];
    } catch (_) {
      this.shops = [];
    }
    try {
      const asg = await PlatformAPI.getShopAssignment('lab');
      this.assignment = asg.data || asg;
      this.entitlementsPreview = this.assignment?.entitlements || null;
    } catch (_) {
      this.assignment = { shop_key: 'lab', package_id: null, addon_ids: [], overrides: [] };
    }
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      <div class="row" style="margin-bottom:16px">
        <div class="grow"><h1>Platform Control</h1>
          <div class="pill">Signed in as ${this.esc(this.user?.username || 'platform')} · Phase 5 shops · lab only</div></div>
        <button class="btn secondary" data-act="sync">Sync catalog</button>
        <button class="btn secondary" data-act="samples">Load lab samples</button>
        <button class="btn secondary" data-act="lab-customers">Seed lab customers</button>
        <button class="btn secondary" data-act="logout">Logout</button>
      </div>
      ${this.message ? `<p class="warn">${this.esc(this.message)}</p>` : ''}
      ${this.error ? `<p class="err">${this.esc(this.error)}</p>` : ''}
      <div class="tabs">
        <button class="tab ${this.tab === 'shops' ? 'active' : ''}" data-tab="shops">Shops</button>
        <button class="tab ${this.tab === 'assign' ? 'active' : ''}" data-tab="assign">Lab assignment</button>
        <button class="tab ${this.tab === 'packages' ? 'active' : ''}" data-tab="packages">Packages</button>
        <button class="tab ${this.tab === 'addons' ? 'active' : ''}" data-tab="addons">Add-ons</button>
        <button class="tab ${this.tab === 'modules' ? 'active' : ''}" data-tab="modules">Modules</button>
      </div>
      ${this.tab === 'shops' ? this.renderShops() : ''}
      ${this.tab === 'assign' ? this.renderAssign() : ''}
      ${this.tab === 'packages' ? this.renderPackages() : ''}
      ${this.tab === 'addons' ? this.renderAddons() : ''}
      ${this.tab === 'modules' ? this.renderModules() : ''}
    </div>`;
    this.bind();
  },

  renderShops() {
    const s = this.selectedShop;
    const flags = s?.entitlements?.flags || {};
    const flagRows = Object.entries(flags).map(([k, v]) =>
      `<tr><td>${this.esc(k)}</td><td>${v ? '<span class="badge sellable">ON</span>' : '<span class="badge">OFF</span>'}</td></tr>`
    ).join('') || '<tr><td colspan="2" class="muted">Select a shop</td></tr>';
    return `<div class="grid2">
      <div class="card">
        <h2>Create shop (record only)</h2>
        <p class="muted">Does <strong>not</strong> create Railway. No Chisa Food data is copied.</p>
        <div style="margin:8px 0"><label>Shop name *</label><input id="sh-name" placeholder="Acme Cafe"></div>
        <div style="margin:8px 0"><label>Owner name</label><input id="sh-owner"></div>
        <div style="margin:8px 0"><label>Owner email</label><input id="sh-email" type="email"></div>
        <div style="margin:8px 0"><label>Phone</label><input id="sh-phone"></div>
        <div style="margin:8px 0"><label>Package</label>
          <select id="sh-pkg"><option value="">— none —</option>
            ${this.packages.map((p) => `<option value="${this.esc(p.id)}">${this.esc(p.name)}</option>`).join('')}
          </select></div>
        <div style="margin:8px 0"><label>Add-ons</label>
          <div class="module-list" style="max-height:120px" id="sh-addons">
            ${this.addons.map((ad) => `<label class="module-item">
              <input type="checkbox" value="${this.esc(ad.id)}">
              <div><strong>${this.esc(ad.name)}</strong></div></label>`).join('') || '<p class="muted">No add-ons</p>'}
          </div></div>
        <div style="margin:8px 0"><label>Status</label>
          <select id="sh-status">
            <option value="TRIAL">TRIAL</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="OVERDUE">OVERDUE</option>
            <option value="SUSPENDED">SUSPENDED</option>
          </select></div>
        <button class="btn" data-act="create-shop">Create shop</button>
      </div>
      <div class="card">
        <h2>SaaS shops (${this.shops.length})</h2>
        <div class="row" style="margin-bottom:8px">
          <div class="grow"><input id="sh-filter" value="${this.esc(this.shopFilter)}" placeholder="Search shops…"></div>
          <select id="sh-status-filter">
            <option value="">All statuses</option>
            ${['TRIAL','ACTIVE','OVERDUE','SUSPENDED'].map((st) =>
              `<option value="${st}" ${this.shopStatusFilter === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
          <button class="btn secondary" data-act="filter-shops">Filter</button>
        </div>
        <table class="table"><thead><tr>
          <th>Shop</th><th>Owner</th><th>Package</th><th>Status</th><th>Deploy</th><th></th>
        </tr></thead><tbody>
          ${this.shops.map((sh) => `<tr>
            <td><strong>${this.esc(sh.shop_name)}</strong><div class="muted">${this.esc(sh.id)}</div>
              <div class="muted">${this.esc(sh.shop_url || '—')}</div></td>
            <td>${this.esc(sh.owner_name || '—')}<div class="muted">${this.esc(sh.owner_email || '')}</div></td>
            <td class="muted">${this.esc(sh.package_name || '—')}<div>${(sh.addon_names || []).map((n) => this.esc(n)).join(', ') || ''}</div></td>
            <td><span class="badge ${sh.subscription_status === 'SUSPENDED' ? '' : 'sellable'}">${this.esc(sh.subscription_status)}</span>
              <div class="muted">${sh.is_active ? 'active' : 'inactive'}</div></td>
            <td class="muted">${this.esc(sh.deployment_status)}</td>
            <td><button class="btn secondary" data-open-shop="${this.esc(sh.id)}">Open</button></td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">No shops yet</td></tr>'}
        </tbody></table>
      </div>
    </div>
    ${s ? `<div class="card" style="margin-top:16px">
      <h2>${this.esc(s.shop_name)} <span class="muted">${this.esc(s.id)}</span></h2>
      <div class="grid2">
        <div>
          <h3>Package &amp; add-ons</h3>
          <div style="margin:8px 0"><label>Package</label>
            <select id="det-pkg">
              <option value="">— none —</option>
              ${this.packages.map((p) => `<option value="${this.esc(p.id)}" ${s.package_id === p.id ? 'selected' : ''}>${this.esc(p.name)}</option>`).join('')}
            </select></div>
          <div class="module-list" style="max-height:140px" id="det-addons">
            ${this.addons.map((ad) => `<label class="module-item">
              <input type="checkbox" value="${this.esc(ad.id)}" ${(s.addon_ids || []).includes(ad.id) ? 'checked' : ''}>
              <div><strong>${this.esc(ad.name)}</strong></div></label>`).join('')}
          </div>
          <button class="btn" data-act="save-shop-assign">Save package / add-ons</button>
          <h3 style="margin-top:16px">Subscription</h3>
          <select id="det-status">
            ${['TRIAL','ACTIVE','OVERDUE','SUSPENDED'].map((st) =>
              `<option value="${st}" ${s.subscription_status === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
          <button class="btn secondary" data-act="save-shop-status">Update status</button>
          <h3 style="margin-top:16px">Module overrides (JSON)</h3>
          <textarea id="det-overrides" rows="5">${this.esc(JSON.stringify((s.overrides || []).map((o) => ({
            module_id: o.module_id, enabled: Number(o.enabled), reason: o.reason || ''
          })), null, 2))}</textarea>
          <button class="btn secondary" data-act="save-shop-overrides">Save overrides</button>
          <h3 style="margin-top:16px">Provision</h3>
          <p class="muted">Dry-run never creates Railway resources. Real provision creates a NEW project + Postgres + app (never Chisa Food).</p>
          <div class="row">
            <button class="btn secondary" data-act="provision-dry">Dry run</button>
            <button class="btn" data-act="provision-run">Provision for real</button>
            <button class="btn secondary" data-act="shop-health">Health check</button>
            <button class="btn secondary" data-act="sync-entitlements">Sync entitlements to customer</button>
          </div>
          <pre id="prov-out" class="muted" style="white-space:pre-wrap;font-size:12px;margin-top:8px;max-height:280px;overflow:auto">${this.esc(this.provisionPreview ? JSON.stringify(this.provisionPreview, null, 2) : '')}</pre>
        </div>
        <div>
          <h3>Effective entitlements</h3>
          <table class="table"><thead><tr><th>Flag</th><th>State</th></tr></thead><tbody>${flagRows}</tbody></table>
          <h3 style="margin-top:12px">Customer detail</h3>
          <pre class="muted" style="white-space:pre-wrap;font-size:12px">${this.esc(JSON.stringify({
            owner: s.owner_name,
            email: s.owner_email,
            url: s.shop_url,
            railway_project_id: s.railway_project_id,
            railway_service_id: s.railway_service_id,
            deployment_status: s.deployment_status,
            package: s.package_name,
            addons: s.addon_names,
            subscription_status: s.subscription_status,
            trial_start: s.trial_start,
            trial_end: s.trial_end,
            created_at: s.created_at,
            health: this.shopHealthPreview || null,
            entitlements_meta: s.entitlements?.meta || {}
          }, null, 2))}</pre>
        </div>
      </div>
    </div>` : ''}`;
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
        await this.loadAll();
        this.view = 'app';
        this.error = '';
        this.render();
      } catch (e) {
        const err = document.getElementById('pf-err');
        if (err) err.textContent = e.message;
      }
    });
    root.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
      this.tab = btn.getAttribute('data-tab');
      this.render();
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
        this.message = `Catalog synced (${r.upserted || 0} modules)`;
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="samples"]')?.addEventListener('click', async () => {
      try {
        await PlatformAPI.bootstrapLabSamples();
        await this.loadAll();
        this.message = 'Lab sample packages/add-ons loaded (editable — not hard product limits)';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="lab-customers"]')?.addEventListener('click', async () => {
      try {
        await PlatformAPI.bootstrapLabCustomers();
        await this.loadAll();
        this.tab = 'shops';
        this.message = 'Lab customers A/B seeded (platform records only)';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="create-shop"]')?.addEventListener('click', async () => {
      try {
        const addon_ids = [...document.querySelectorAll('#sh-addons input:checked')].map((el) => el.value);
        const r = await PlatformAPI.createShop({
          shop_name: document.getElementById('sh-name').value.trim(),
          owner_name: document.getElementById('sh-owner').value.trim(),
          owner_email: document.getElementById('sh-email').value.trim(),
          contact_phone: document.getElementById('sh-phone').value.trim(),
          package_id: document.getElementById('sh-pkg').value || null,
          addon_ids,
          subscription_status: document.getElementById('sh-status').value
        });
        await this.loadAll();
        this.selectedShop = await PlatformAPI.getShop(r.id || r.data?.id);
        this.message = 'Shop created (record only — no Railway)';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="filter-shops"]')?.addEventListener('click', async () => {
      this.shopFilter = document.getElementById('sh-filter')?.value || '';
      this.shopStatusFilter = document.getElementById('sh-status-filter')?.value || '';
      await this.loadAll();
      this.render();
    });
    root.querySelectorAll('[data-open-shop]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        this.selectedShop = await PlatformAPI.getShop(btn.getAttribute('data-open-shop'));
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
    root.querySelector('[data-act="save-shop-assign"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        const addon_ids = [...document.querySelectorAll('#det-addons input:checked')].map((el) => el.value);
        await PlatformAPI.assignShop(id, {
          package_id: document.getElementById('det-pkg').value || null,
          addon_ids
        });
        this.selectedShop = await PlatformAPI.getShop(id);
        await this.loadAll();
        this.message = 'Package/add-ons updated (entitlements recalculated)';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="save-shop-status"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        await PlatformAPI.setShopStatus(id, document.getElementById('det-status').value);
        this.selectedShop = await PlatformAPI.getShop(id);
        await this.loadAll();
        this.message = 'Subscription status updated';
        this.error = '';
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
      if (!confirm('Create a NEW Railway project + Postgres + app for this shop? This will not touch Chisa Food.')) return;
      try {
        const id = this.selectedShop?.id;
        this.message = 'Provisioning… this can take several minutes';
        this.render();
        const r = await PlatformAPI.provisionRun(id);
        this.provisionPreview = r;
        this.selectedShop = await PlatformAPI.getShop(id);
        await this.loadAll();
        this.message = r.status === 'READY' ? 'Provision READY' : ('Provision finished: ' + (r.status || 'done'));
        this.error = r.status === 'FAILED' ? (r.error || 'Failed') : '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
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
      if (!confirm('Delete this package?')) return;
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
      if (!confirm('Delete this add-on?')) return;
      try {
        await PlatformAPI.deleteAddon(btn.getAttribute('data-del-ad'));
        this.addonDraft = null;
        await this.loadAll();
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    }));
  }
};

PlatformApp.init();
window.PlatformApp = PlatformApp;
