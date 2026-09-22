/**
 * SaaS feature visibility — show full catalog; lock unavailable modules.
 * Presentation only. Server entitlements remain authoritative.
 */
(function (global) {
  const SaasFeatures = {
    _catalog: null,
    _catalogAt: 0,

    async loadCatalog(force = false) {
      if (!force && this._catalog && (Date.now() - this._catalogAt) < 8000) return this._catalog;
      try {
        const res = await (global.API?.getFeatureCatalog?.() || Promise.resolve(null));
        const data = res?.data || res;
        if (data && (data.modules || data.summary)) {
          this._catalog = data;
          this._catalogAt = Date.now();
          try { global.__SHOP_POS_FEATURE_CATALOG__ = data; } catch (_) { /* */ }
          return data;
        }
      } catch (_) { /* */ }
      return this._catalog || null;
    },

    invalidate() {
      this._catalog = null;
      this._catalogAt = 0;
    },

    findModule(moduleId) {
      const cat = this._catalog || global.__SHOP_POS_FEATURE_CATALOG__;
      if (!cat?.modules) return null;
      return cat.modules.find((m) => m.id === moduleId) || null;
    },

    findForPage(page) {
      const cat = this._catalog || global.__SHOP_POS_FEATURE_CATALOG__;
      const row = cat?.nav_pages?.find((p) => p.page === page);
      if (row) return row;
      return null;
    },

    findForAdminSection(section) {
      const cat = this._catalog || global.__SHOP_POS_FEATURE_CATALOG__;
      return cat?.admin_sections?.find((s) => s.section === section) || null;
    },

    showUpgradeModal(opts = {}) {
      const title = opts.title || opts.name || 'Feature locked';
      const description = opts.description || '';
      const packageName = opts.current_package?.name
        || this._catalog?.current_package?.name
        || 'Your current package';
      const pkgs = opts.available_in_packages || [];
      const addons = opts.available_as_addons || [];
      const missing = opts.missing_dependencies || [];
      const instruction = this._catalog?.upgrade_instruction
        || 'Contact your administrator to upgrade your package or add-ons.';

      const pkgList = pkgs.length
        ? `<p><strong>Available with:</strong></p><ul>${pkgs.map((p) => `<li>${Utils.escHtml(p.name || p.id)}</li>`).join('')}</ul>`
        : '';
      const addonList = addons.length
        ? `<p><strong>Available as an Add-on:</strong></p><ul>${addons.map((a) => `<li>${Utils.escHtml(a.name || a.id)}</li>`).join('')}</ul>`
        : '';
      const depList = missing.length
        ? `<p><strong>Requires:</strong></p><ul>${missing.map((d) => {
          const m = this.findModule(d);
          return `<li>${Utils.escHtml(m?.name || d)}</li>`;
        }).join('')}</ul>`
        : '';

      const body = `
        <div class="saas-upgrade-body">
          <p class="saas-upgrade-lead">This module is not included in your current package.</p>
          <p><strong>Current Package:</strong> ${Utils.escHtml(packageName)}</p>
          ${description ? `<p class="muted">${Utils.escHtml(description)}</p>` : ''}
          ${depList}
          ${pkgList}
          ${addonList}
          ${!pkgs.length && !addons.length && !missing.length
            ? `<p class="muted">Upgrade your package or enable the matching add-on to unlock this feature.</p>`
            : ''}
          <p class="saas-upgrade-hint muted">${Utils.escHtml(instruction)}</p>
        </div>`;
      const footer = `
        <button type="button" class="btn btn-ghost" id="saas-upgrade-explore">Explore All Features</button>
        <button type="button" class="btn btn-primary" id="saas-upgrade-close">Close</button>`;
      Utils.showModal(title, body, footer, { wide: true });
      document.getElementById('saas-upgrade-close')?.addEventListener('click', () => Utils.hideModal());
      document.getElementById('saas-upgrade-explore')?.addEventListener('click', () => {
        Utils.hideModal();
        if (global.App?.navigate) global.App.navigate('features');
      });
    },

    openLockedPage(page) {
      const row = this.findForPage(page);
      const modId = row?.module_ids?.[0];
      const mod = modId ? this.findModule(modId) : null;
      this.showUpgradeModal({
        title: row?.name || mod?.name || page,
        name: row?.name || mod?.name || page,
        description: row?.description || mod?.description || '',
        available_in_packages: row?.available_in_packages || mod?.available_in_packages || [],
        available_as_addons: row?.available_as_addons || mod?.available_as_addons || [],
        missing_dependencies: row?.missing_dependencies || mod?.missing_dependencies || [],
        current_package: this._catalog?.current_package
      });
    },

    openLockedAdminSection(section) {
      const row = this.findForAdminSection(section);
      const mod = row?.module_id ? this.findModule(row.module_id) : null;
      this.showUpgradeModal({
        title: row?.name || mod?.name || section,
        name: row?.name || mod?.name || section,
        description: row?.description || mod?.description || '',
        available_in_packages: row?.available_in_packages || mod?.available_in_packages || [],
        available_as_addons: row?.available_as_addons || mod?.available_as_addons || [],
        missing_dependencies: row?.missing_dependencies || mod?.missing_dependencies || [],
        current_package: this._catalog?.current_package
      });
    },

    openLockedModule(moduleId) {
      const mod = this.findModule(moduleId) || { id: moduleId, name: moduleId };
      this.showUpgradeModal({
        title: mod.name || moduleId,
        description: mod.description || '',
        available_in_packages: mod.available_in_packages || [],
        available_as_addons: mod.available_as_addons || [],
        missing_dependencies: mod.missing_dependencies || [],
        current_package: this._catalog?.current_package
      });
    },

    summaryHtml() {
      const cat = this._catalog || global.__SHOP_POS_FEATURE_CATALOG__;
      if (!cat?.summary) return '';
      const pkg = cat.current_package?.name || 'Current package';
      return `<div class="saas-plan-summary card" style="margin-bottom:16px">
        <div class="card-body" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
          <div>
            <div class="muted" style="font-size:12px">YOUR PACKAGE</div>
            <strong>${Utils.escHtml(pkg)}</strong>
            <div style="margin-top:6px">${cat.summary.included} Features Included · ${cat.summary.available_additional} Additional Features</div>
          </div>
          <button type="button" class="btn btn-primary" id="saas-dash-explore">Explore All Features</button>
        </div>
      </div>`;
    },

    async renderExplorer(el) {
      try {
        await global.App?.loadEntitlements?.();
        global.App?.renderNav?.();
        global.AdminPage?.refreshAdminNav?.();
      } catch (_) { /* ignore */ }
      const cat = await this.loadCatalog(true);
      if (!el) return;
      if (!cat) {
        el.innerHTML = `<div class="page-toolbar"><h3>Explore All Features</h3></div>
          <p class="muted">Feature catalog is not available on this shop yet.</p>`;
        return;
      }
      const pkg = cat.current_package?.name || '—';
      const rows = (cat.modules || [])
        .filter((m) => m.commercial_class !== 'shared_core' && m.kind !== 'shared_core')
        .map((m) => {
          const status = m.included
            ? '<span class="saas-feat-status saas-feat-included">✓ Available</span>'
            : '<span class="saas-feat-status saas-feat-locked">🔒 Locked</span>';
          const req = m.included
            ? 'Included'
            : (m.available_as_addons?.length
              ? m.available_as_addons.map((a) => a.name).join(', ')
              : (m.available_in_packages?.length
                ? m.available_in_packages.map((p) => p.name).join(', ')
                : 'Upgrade required'));
          const click = m.included ? '' : ` data-saas-mod="${Utils.escHtml(m.id)}"`;
          return `<tr class="${m.included ? '' : 'saas-feat-row-locked'}"${click}>
            <td><strong>${Utils.escHtml(m.name)}</strong><div class="muted" style="font-size:12px">${Utils.escHtml(m.description || '')}</div></td>
            <td>${status}</td>
            <td>${Utils.escHtml(req)}</td>
          </tr>`;
        }).join('');

      el.innerHTML = `<div class="page-toolbar"><h3>Explore All Features</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="saas-refresh-plan">Refresh plan</button>
        </div>
        <p class="muted">Current package: <strong>${Utils.escHtml(pkg)}</strong>. Locked features stay visible — upgrade on Platform Control to unlock. Server access control is unchanged.</p>
        <div class="table-wrap"><table class="data-table saas-feat-table">
          <thead><tr><th>Feature</th><th>Status</th><th>Package / Add-on</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">No catalog modules synced yet.</td></tr>'}</tbody>
        </table></div>`;
      el.querySelector('#saas-refresh-plan')?.addEventListener('click', async () => {
        try {
          await global.App?.refreshEntitlementsAndNav?.({ force: true });
          await this.renderExplorer(el);
          Utils.toast('Plan refreshed', 'success');
        } catch (e) {
          Utils.toast(e?.message || 'Refresh failed', 'error');
        }
      });
      el.querySelectorAll('[data-saas-mod]').forEach((tr) => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => this.openLockedModule(tr.getAttribute('data-saas-mod')));
      });
    }
  };

  global.SaasFeatures = SaasFeatures;

  global.FeaturesPage = {
    async render(el) {
      await SaasFeatures.renderExplorer(el);
    },
    async activate(el) {
      await SaasFeatures.renderExplorer(el);
    }
  };
})(typeof window !== 'undefined' ? window : global);
