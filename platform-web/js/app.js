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
    const defStart = new Date().toISOString().slice(0, 10);
    const defEnd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return `<div class="grid2">
      <div class="card">
        <h2>Create Customer</h2>
        <p class="muted">Registers the customer on the platform. Provisioning (Railway) is a separate step after create.</p>
        <div class="grid2" style="gap:8px">
          <div style="margin:8px 0"><label>Shop name *</label><input id="sh-name" placeholder="Acme Cafe"></div>
          <div style="margin:8px 0"><label>Owner / customer name *</label><input id="sh-owner" placeholder="Jane Owner"></div>
          <div style="margin:8px 0"><label>Email *</label><input id="sh-email" type="email" placeholder="owner@example.com"></div>
          <div style="margin:8px 0"><label>Phone</label><input id="sh-phone" placeholder="+27…"></div>
        </div>
        <div style="margin:8px 0"><label>Address</label><input id="sh-address" placeholder="Street, city"></div>
        <div style="margin:8px 0"><label>Package *</label>
          <select id="sh-pkg"><option value="">— select package —</option>
            ${this.packages.map((p) => `<option value="${this.esc(p.id)}">${this.esc(p.name)}</option>`).join('')}
          </select></div>
        <div style="margin:8px 0"><label>Add-ons</label>
          <div class="module-list" style="max-height:120px" id="sh-addons">
            ${this.addons.map((ad) => `<label class="module-item">
              <input type="checkbox" value="${this.esc(ad.id)}">
              <div><strong>${this.esc(ad.name)}</strong></div></label>`).join('') || '<p class="muted">No add-ons</p>'}
          </div></div>
        <div class="grid2" style="gap:8px">
          <div style="margin:8px 0"><label>Subscription start</label><input id="sh-start" type="date" value="${defStart}"></div>
          <div style="margin:8px 0"><label>Subscription expiry</label><input id="sh-expiry" type="date" value="${defEnd}"></div>
          <div style="margin:8px 0"><label>Grace period (days)</label><input id="sh-grace" type="number" min="0" value="3"></div>
          <div style="margin:8px 0"><label>Status</label>
            <select id="sh-status">
              <option value="TRIAL">TRIAL</option>
              <option value="ACTIVE" selected>ACTIVE</option>
              <option value="OVERDUE">OVERDUE</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="EXPIRED">EXPIRED</option>
            </select></div>
        </div>
        <div style="margin:8px 0"><label>Notes</label><textarea id="sh-notes" rows="2" placeholder="Internal notes (optional)"></textarea></div>
        <button class="btn" data-act="create-shop">Create Customer</button>
      </div>
      <div class="card">
        <h2>Customers / Shops (${this.shops.length})</h2>
        <div class="row" style="margin-bottom:8px">
          <div class="grow"><input id="sh-filter" value="${this.esc(this.shopFilter)}" placeholder="Search shops…"></div>
          <select id="sh-status-filter">
            <option value="">All statuses</option>
            ${['TRIAL','ACTIVE','OVERDUE','SUSPENDED','EXPIRED'].map((st) =>
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
            ${['TRIAL','ACTIVE','OVERDUE','SUSPENDED','EXPIRED'].map((st) =>
              `<option value="${st}" ${s.subscription_status === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
          <button class="btn secondary" data-act="save-shop-status">Update status</button>
          ${this.renderCustomerControl(s)}
          <h3 style="margin-top:16px">Module overrides (JSON)</h3>
          <textarea id="det-overrides" rows="5">${this.esc(JSON.stringify((s.overrides || []).map((o) => ({
            module_id: o.module_id, enabled: Number(o.enabled), reason: o.reason || ''
          })), null, 2))}</textarea>
          <button class="btn secondary" data-act="save-shop-overrides">Save overrides</button>
          <h3 style="margin-top:16px">Provision</h3>
          <p class="muted">Creates a NEW Railway project + Postgres + app for this customer (never Chisa Food).</p>
          <div class="row">
            <button class="btn secondary" data-act="provision-dry">Dry run</button>
            <button class="btn" data-act="provision-run">Provision for real</button>
            <button class="btn secondary" data-act="shop-health">Health check</button>
            <button class="btn secondary" data-act="sync-entitlements">Sync entitlements to customer</button>
            ${this.provisionFailed ? '<button class="btn" data-act="provision-run">Retry provision</button>' : ''}
          </div>
          ${this.renderProvisionProgress()}
        </div>
        <div>
          <h3>Effective entitlements</h3>
          <table class="table"><thead><tr><th>Flag</th><th>State</th></tr></thead><tbody>${flagRows}</tbody></table>
          <h3 style="margin-top:12px">Customer detail</h3>
          <pre class="muted" style="white-space:pre-wrap;font-size:12px">${this.esc(JSON.stringify({
            owner: s.owner_name,
            email: s.owner_email,
            phone: s.contact_phone,
            address: s.address,
            url: s.shop_url,
            railway_project_id: s.railway_project_id,
            railway_service_id: s.railway_service_id,
            deployment_status: s.deployment_status,
            package: s.package_name,
            addons: s.addon_names,
            subscription_status: s.subscription_status,
            subscription_start: s.subscription_start || s.trial_start,
            subscription_expiry: s.subscription_expiry || s.trial_end,
            grace_days: s.grace_days,
            notes: s.notes,
            created_at: s.created_at,
            health: this.shopHealthPreview || null
          }, null, 2))}</pre>
        </div>
      </div>
    </div>` : ''}`;
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
        ? `<pre class="muted" style="white-space:pre-wrap;font-size:12px;margin-top:8px;max-height:160px;overflow:auto">${this.esc(JSON.stringify(this.provisionPreview, null, 2))}</pre>`
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

  renderCustomerControl(s) {
    const c = this.control;
    if (!c || c.customer?.id !== s.id) {
      return `<h3 style="margin-top:16px">Customer control</h3>
        <button class="btn secondary" data-act="load-control">Load contract, activation, devices, fees, audit</button>`;
    }
    const cd = c.subscription || {};
    const contract = c.contract || {};
    const access = c.access || {};
    const fee = c.service_fee || {};
    const acts = c.activation || [];
    const devices = c.devices || [];
    const audit = c.audit || [];
    const secret = this.lastActivation;
    return `<div style="margin-top:16px;border-top:1px solid #ccc;padding-top:12px">
      <h3>Customer control</h3>
      <p class="muted">Registration is stored on the platform shop record (separate from the customer business database).</p>
      <p><strong>Access:</strong> ${this.esc(access.access_state || '—')} ·
        <strong>Days remaining:</strong> ${cd.days_remaining == null ? '—' : this.esc(cd.days_remaining)} ·
        <strong>Expiry:</strong> ${this.esc(cd.expiry_date || '—')} ·
        <strong>Grace:</strong> ${this.esc(cd.grace_period_days ?? '—')} days
        ${cd.suspension_date ? ` · <strong>Suspended:</strong> ${this.esc(cd.suspension_date)}` : ''}</p>
      <h4>Contract</h4>
      <p>${contract.accepted ? `Accepted ${this.esc(contract.latest_acceptance?.version_label || '')} at ${this.esc(contract.latest_acceptance?.accepted_at || '')}` : 'Not accepted'}
        ${contract.needs_reacceptance ? ' · <strong>Re-acceptance required</strong>' : ''}</p>
      <div class="row">
        <button class="btn secondary" data-act="accept-contract">Record acceptance</button>
        <button class="btn secondary" data-act="print-contract">Print accepted agreement</button>
        <button class="btn secondary" data-act="new-contract">New agreement version</button>
      </div>
      <h4>Activation</h4>
      <div class="row">
        <button class="btn" data-act="gen-activation">Generate Activation Link</button>
        <button class="btn secondary" data-act="regen-activation">Regenerate</button>
      </div>
      ${secret ? (() => {
        const link = secret.activation_link
          || (s.shop_url && secret.link_token
            ? `${String(s.shop_url).replace(/\/$/, '')}/activate?token=${encodeURIComponent(secret.link_token)}&shop=${encodeURIComponent(s.id)}`
            : '');
        return `<div class="activation-box">
        <label>Complete activation URL</label>
        <input id="act-link" readonly value="${this.esc(link || '(set customer shop URL / PLATFORM_PUBLIC_BASE_URL)')}" />
        <p class="muted" style="margin:8px 0">Code (show once): <code>${this.esc(secret.code || '—')}</code> · Expires ${this.esc(secret.expires_at || '—')}</p>
        <div class="row">
          <button class="btn" data-act="copy-activation" ${link ? '' : 'disabled'}>Copy Activation Link</button>
          <a class="btn secondary" ${link ? `href="${this.esc(link)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'} ${link ? '' : 'onclick="return false"'}>Open Activation Link</a>
          <button class="btn secondary" data-act="regen-activation">Regenerate</button>
          ${acts.find((a) => a.status === 'active') ? `<button class="btn secondary" data-revoke-act="${this.esc(acts.find((a) => a.status === 'active').id)}">Revoke</button>` : ''}
        </div>
      </div>`;
      })() : ''}
      <ul class="muted">${acts.map((a) => `<li>${this.esc(a.status)} · hint …${this.esc(a.code_hint)} · uses ${a.use_count}/${a.max_uses} · exp ${this.esc(a.expires_at)}
        ${a.status === 'active' ? `<button class="btn secondary" data-revoke-act="${this.esc(a.id)}">Revoke</button>` : ''}</li>`).join('') || '<li>No activations</li>'}</ul>
      <h4>Devices</h4>
      <ul class="muted">${devices.map((d) => `<li>${this.esc(d.device_name)} · ${this.esc(d.device_type)} · ${this.esc(d.status)} · last ${this.esc(d.last_connection || '—')}
        ${d.status !== 'revoked' ? `<button class="btn secondary" data-revoke-dev="${this.esc(d.id)}">Revoke</button>` : ''}</li>`).join('') || '<li>No devices</li>'}</ul>
      <h4>Service fee (${this.esc(fee.source || 'none')})</h4>
      <div class="row">
        <select id="fee-type">
          <option value="percent">Percent</option>
          <option value="fixed">Fixed</option>
          <option value="percent_plus_fixed">Percent + fixed</option>
        </select>
        <input id="fee-percent" type="number" step="0.01" placeholder="%" style="width:80px">
        <input id="fee-fixed" type="number" step="0.01" placeholder="Fixed" style="width:80px">
        <button class="btn secondary" data-act="save-fee">Save customer fee</button>
      </div>
      <p class="muted">${fee.enabled ? `Enabled · ${this.esc(fee.config?.fee_type)} ${fee.config?.percent || 0}% + ${fee.config?.fixed_amount || 0}` : 'Disabled / none'}</p>
      <h4>Audit</h4>
      <ul class="muted" style="max-height:160px;overflow:auto">${audit.slice(0, 12).map((a) =>
        `<li>${this.esc(a.created_at)} · ${this.esc(a.actor)} · ${this.esc(a.action)}</li>`).join('') || '<li>No audit</li>'}</ul>
    </div>`;
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
        const name = document.getElementById('sh-name').value.trim();
        const owner = document.getElementById('sh-owner').value.trim();
        const email = document.getElementById('sh-email').value.trim();
        const pkg = document.getElementById('sh-pkg').value || null;
        if (!name || !owner || !email || !pkg) {
          throw new Error('Shop name, owner name, email, and package are required');
        }
        const start = document.getElementById('sh-start')?.value;
        const expiry = document.getElementById('sh-expiry')?.value;
        const toIso = (d, end) => d ? new Date(d + (end ? 'T23:59:59.000Z' : 'T00:00:00.000Z')).toISOString() : null;
        const r = await PlatformAPI.createShop({
          shop_name: name,
          owner_name: owner,
          owner_email: email,
          contact_phone: document.getElementById('sh-phone').value.trim(),
          address: document.getElementById('sh-address')?.value.trim() || '',
          package_id: pkg,
          addon_ids,
          subscription_status: document.getElementById('sh-status').value,
          subscription_start: toIso(start, false),
          subscription_expiry: toIso(expiry, true),
          grace_days: Number(document.getElementById('sh-grace')?.value || 3),
          notes: document.getElementById('sh-notes')?.value.trim() || ''
        });
        await this.loadAll();
        this.selectedShop = await PlatformAPI.getShop(r.id || r.data?.id);
        this.message = 'Customer created — next: Provision for real';
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
    const reloadControl = async () => {
      const id = this.selectedShop?.id;
      this.control = await PlatformAPI.customerControl(id);
      this.render();
    };
    root.querySelector('[data-act="load-control"]')?.addEventListener('click', async () => {
      try {
        await reloadControl();
        this.message = 'Customer control loaded';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="accept-contract"]')?.addEventListener('click', async () => {
      try {
        const id = this.selectedShop?.id;
        await PlatformAPI.acceptContract(id, {
          accepted_by_name: this.selectedShop.owner_name,
          accepted_by_email: this.selectedShop.owner_email
        });
        this.lastActivation = null;
        await reloadControl();
        this.message = 'Contract acceptance recorded';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="print-contract"]')?.addEventListener('click', async () => {
      try {
        const doc = await PlatformAPI.printContract(this.selectedShop.id);
        const w = window.open('', '_blank');
        w.document.write(`<pre style="white-space:pre-wrap;font-family:serif;padding:24px">${this.esc(doc.title)}\n\n${this.esc(doc.body_text)}\n\nAccepted: ${this.esc(doc.accepted_at)} by ${this.esc(doc.accepted_by_name)}\n${this.esc(doc.legal_notice || '')}</pre>`);
        w.document.close();
        w.print();
      } catch (e) { this.error = e.message; this.render(); }
    });
    root.querySelector('[data-act="new-contract"]')?.addEventListener('click', async () => {
      try {
        const label = prompt('New version label', 'v' + (Date.now() % 10000));
        if (!label) return;
        await PlatformAPI.createContractVersion({
          version_label: label,
          title: 'Shop POS Customer Agreement',
          body_text: 'DRAFT — Configurable. Must be reviewed by a qualified South African legal professional before commercial use.\n\nUpdated terms for ' + label,
          activate: true
        });
        await reloadControl();
        this.message = 'New contract version activated — customers may need re-acceptance';
        this.error = '';
        this.render();
      } catch (e) { this.error = e.message; this.render(); }
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
          enabled: true,
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
      if (!confirm('Create a NEW Railway project + Postgres + app for this shop? This will not touch Chisa Food.')) return;
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
