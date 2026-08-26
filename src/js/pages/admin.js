const AdminPage = {
  section: 'overview',
  settings: null,

  sections: [
    { id: 'overview', label: '🏠 Overview', icon: 'overview' },
    { id: 'printer', label: '🖨️ Printer Setup', icon: 'printer' },
    { id: 'payments', label: '💳 Payment Methods', icon: 'payments' },
    { id: 'receipt', label: '🧾 Receipt Designer', icon: 'receipt' },
    { id: 'security', label: '🔒 Security', icon: 'security' },
    { id: 'quotes', label: '📄 Quotes', icon: 'quotes' },
    { id: 'permissions', label: '👥 Permissions', icon: 'permissions' },
    { id: 'sales-targets', label: '🎯 Sales Targets', icon: 'targets' },
    { id: 'top-customers', label: '⭐ Top Customers', icon: 'customers' },
    { id: 'approvals', label: '✅ Settings Approvals', icon: 'approvals' },
    { id: 'tax', label: '💰 Tax & Currency', icon: 'tax' },
    { id: 'tax-hub', label: '📊 Tax Calculations', icon: 'tax' },
    { id: 'cashiers', label: '🧑‍💼 Cashiers & Managers', icon: 'permissions' },
    { id: 'shifts', label: '⏱️ Shift Management', icon: 'shifts' },
    { id: 'operating', label: '🕐 Operating Hours', icon: 'operating' },
    { id: 'cashdrawer', label: '💵 Cash Drawer', icon: 'cashdrawer' },
    { id: 'analytics', label: '📊 Sales Analytics', icon: 'analytics' },
    { id: 'inventory', label: '📦 Inventory', icon: 'inventory' },
    { id: 'discounts', label: '🏷️ Discounts', icon: 'discounts' },
    { id: 'loyalty', label: '⭐ Loyalty Points', icon: 'loyalty' },
    { id: 'customer-rewards', label: '🎁 Customer Gift Rewards', icon: 'loyalty' },
    { id: 'importexport', label: '📁 Import & Export', icon: 'importexport' },
    { id: 'customize', label: '🎨 Customization', icon: 'customize' },
    { id: 'branches', label: '🏢 Branches', icon: 'branches' },
    { id: 'device', label: '💻 Device Settings', icon: 'device' },
    { id: 'backup', label: '💾 Backup & Restore', icon: 'backup' },
    { id: 'opscompliance', label: '📋 Operations & Compliance', icon: 'opscompliance' },
    { id: 'combos', label: '🎁 Combos & Promos', icon: 'combos' },
    { id: 'recipe', label: '🍳 Recipe & Production', icon: 'recipe' },
    { id: 'staffhr', label: '👷 Staff & HR', icon: 'staffhr' },
    { id: 'staffportal', label: '👷 Staff Portal', icon: 'staffportal' },
    { id: 'onaccount', label: '📒 On Account', icon: 'onaccount' },
    { id: 'hrcontracts', label: '📄 Contracts & Probation', icon: 'hrcontracts' },
    { id: 'recruitment', label: '💼 Recruitment', icon: 'recruitment' },
    { id: 'marketing-mgmt', label: '📣 Marketing Management', icon: 'marketing' },
    { id: 'payroll', label: '💼 Payroll & Compliance', icon: 'payroll' },
    { id: 'employee-of-month', label: '🏆 Employee of Month', icon: 'employee-of-month' }
  ],

  async render(el, app) {
    this.app = app;
    // Paint shell immediately from in-memory settings — never blank-wait on RPC
    this.settings = this.settings || app.settings || {};

    el.innerHTML = `<div class="admin-layout">
      <div class="admin-sidebar-col">
        <div class="admin-search-bar">
          <input type="search" id="admin-global-search" placeholder="Search admin, staff, products…" autocomplete="off">
          <div id="admin-search-results" class="search-dropdown hidden"></div>
        </div>
        <nav class="admin-nav" id="admin-nav">${this.sections.filter(s =>
          Utils.canAccessAdminSection(app.user, s.id)
        ).map(s =>
          `<button class="admin-nav-btn ${s.id === this.section ? 'active' : ''}" data-section="${s.id}">${s.label}</button>`
        ).join('')}</nav>
      </div>
      <div class="admin-content" id="admin-content"></div>
    </div>`;

    const searchInput = el.querySelector('#admin-global-search');
    searchInput?.addEventListener('input', (e) => this.handleAdminSearch(e.target.value));
    searchInput?.addEventListener('blur', () => {
      setTimeout(() => el.querySelector('#admin-search-results')?.classList.add('hidden'), 200);
    });
    searchInput?.addEventListener('focus', () => {
      if (searchInput.value.length >= 2) this.handleAdminSearch(searchInput.value);
    });

    el.querySelector('#admin-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('.admin-nav-btn');
      if (!btn) return;
      if (this.section && this.section !== btn.dataset.section) {
        this._sectionHistory = this._sectionHistory || [];
        this._sectionHistory.push(this.section);
        if (this._sectionHistory.length > 30) this._sectionHistory.shift();
      }
      this.section = btn.dataset.section;
      el.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === this.section));
      this.toggleOpsComplianceLayout(this.section === 'opscompliance');
      this.renderSection(document.getElementById('admin-content'));
    });

    this.toggleOpsComplianceLayout(this.section === 'opscompliance');
    this.renderSection(document.getElementById('admin-content'));

    // Refresh settings in background; re-render active section if values changed
    API.getSettingsParsed().then((res) => {
      if (res?.data) {
        this.settings = res.data;
        if (app) app.settings = res.data;
      }
    }).catch(() => {});
  },

  toggleOpsComplianceLayout(opsOnly) {
    const layout = document.querySelector('.admin-layout');
    if (layout) layout.classList.toggle('admin-ops-full', !!opsOnly);
  },

  refreshAdminNav(containerEl) {
    const root = containerEl || document.querySelector('.admin-layout');
    const nav = root?.querySelector('#admin-nav');
    if (!nav || !this.app?.user) return;
    nav.innerHTML = this.sections.filter(s =>
      Utils.canAccessAdminSection(this.app.user, s.id)
    ).map(s =>
      `<button class="admin-nav-btn ${s.id === this.section ? 'active' : ''}" data-section="${s.id}">${s.label}</button>`
    ).join('');
  },

  async renderSection(el) {
    const lazySections = new Set([
      'hrcontracts', 'recruitment', 'marketing-mgmt', 'employee-of-month', 'staffhr', 'staffportal', 'payroll',
      'opscompliance', 'combos', 'recipe', 'quotes',
      'salesmgmt', 'saleexplorer', 'soldproducts', 'returnsmgmt', 'activity',
      'exceptions', 'alerts', 'dailyclose', 'discount-report'
    ]);
    if (lazySections.has(this.section) && window.App?.ensurePageScripts) {
      await App.ensurePageScripts('admin');
    }

    if (this.section === 'recipe') {
      return this.renderRecipeSection(el);
    }

    const tryModule = async (getPage, renderFn, label) => {
      if (getPage()) return renderFn();
      if (window.App?.ensurePageScripts) await App.ensurePageScripts('admin');
      if (getPage()) return renderFn();
      el.innerHTML = `<div class="admin-section"><p class="muted">${label} module not loaded. Try refreshing the page.</p></div>`;
    };

    const renderers = {
      overview: () => this.renderOverview(el),
      printer: () => this.renderPrinter(el),
      payments: () => this.renderPaymentMethods(el),
      receipt: () => this.renderReceiptDesigner(el),
      security: () => this.renderSecurity(el),
      permissions: () => this.renderPermissions(el),
      'sales-targets': () => this.renderSalesTargets(el),
      'top-customers': () => this.renderTopCustomers(el),
      approvals: () => this.renderSettingsApprovals(el),
      tax: () => this.renderTaxCurrency(el),
      'tax-hub': () => this.renderTaxHub(el),
      cashiers: () => this.renderCashiersPanel(el),
      shifts: () => this.renderShifts(el),
      operating: () => this.renderOperatingHours(el),
      cashdrawer: () => this.renderCashDrawer(el),
      analytics: () => this.renderAnalytics(el),
      inventory: () => this.renderInventory(el),
      discounts: () => this.renderDiscounts(el),
      loyalty: () => this.renderLoyalty(el),
      'customer-rewards': () => this.renderCustomerRewards(el),
      importexport: () => this.renderImportExport(el),
      customize: () => this.renderCustomize(el),
      branches: () => this.renderBranchesSync(el),
      device: () => this.renderDevice(el),
      backup: () => this.renderBackup(el),
      hrcontracts: async () => tryModule(
        () => window.AdminHrPage,
        () => window.AdminHrPage.render(el, this),
        'Contracts & Probation'
      ),
      recruitment: async () => tryModule(
        () => window.AdminRecruitmentPage,
        () => window.AdminRecruitmentPage.render(el, this),
        'Recruitment'
      ),
      'marketing-mgmt': async () => tryModule(
        () => window.AdminMarketingPage,
        () => window.AdminMarketingPage.render(el, this.app || this),
        'Marketing Management'
      ),
      'employee-of-month': async () => tryModule(
        () => window.AdminEmployeeMonthPage,
        () => window.AdminEmployeeMonthPage.render(el, this),
        'Employee of Month'
      ),
      quotes: async () => tryModule(
        () => typeof this.renderQuotesAdmin === 'function',
        () => this.renderQuotesAdmin(el),
        'Quotes'
      ),
      staffportal: () => tryModule(
        () => typeof this.renderStaffPortalHub === 'function',
        () => this.renderStaffPortalHub(el),
        'Staff Portal'
      ),
      staffhr: () => tryModule(
        () => typeof this.renderStaffHR === 'function',
        () => this.renderStaffHR(el),
        'Staff & HR'
      ),
      onaccount: () => tryModule(
        () => typeof this.renderOnAccount === 'function',
        () => this.renderOnAccount(el),
        'On Account'
      ),
      opscompliance: () => tryModule(
        () => typeof this.renderOpsCompliance === 'function',
        () => this.renderOpsCompliance(el),
        'Operations & Compliance'
      )
    };
    el.innerHTML = '<p class="muted">Loading…</p>';
    await (renderers[this.section] || renderers.overview)();
  },

  async renderOverview(el) {
    const s = this.settings;
    el.innerHTML = `<div class="admin-section"><h3>Admin Dashboard</h3><p class="muted">Loading business stats…</p></div>`;
    // Prefer admin dashboard once; fall back to lighter dashboard:stats if needed (avoid double heavy load).
    let dashRes = await API.getAdminDashboard(Utils.today(), Utils.today()).catch(() => ({ success: false }));
    let todayRes = { success: false };
    if (!dashRes.success) {
      todayRes = await API.getDashboardStats(Utils.today(), Utils.today(), this.app.user).catch(() => ({ success: false }));
    }
    const foodRes = await API.recipeFoodCostAlerts(this.app.user).catch(() => ({ success: false }));
    const d = dashRes.success ? (dashRes.data || {}) : {};
    const todayStats = todayRes.success ? (todayRes.data || {}) : {};
    const foodAlerts = foodRes.success ? (foodRes.data || []) : [];
    const currency = s.currency || 'R';
    const dashErr = !dashRes.success && !todayRes.success
      ? `<p class="muted" style="color:var(--danger)">Stats unavailable: ${Utils.escHtml(dashRes.error || todayRes.error || 'error')}</p>`
      : '';
    el.innerHTML = `<div class="admin-section">
      <h3>Admin Dashboard</h3>
      <p class="muted">Till rules, printers, PINs, loyalty, and staff live here. Shop name / theme / backup is under sidebar <strong>Settings</strong>.</p>
      ${dashErr}
      <div class="stats-grid" style="margin-top:20px">
        <div class="stat-card primary"><div class="label">Today's Sales</div><div class="value">${Utils.formatMoney(d.today?.sales ?? todayStats.todaySales ?? 0, currency)}</div><small>${d.today?.orders ?? todayStats.todayCount ?? 0} orders</small></div>
        <div class="stat-card success"><div class="label">Gross Profit Today</div><div class="value">${Utils.formatMoney(d.today?.grossProfit ?? todayStats.profit ?? 0, currency)}</div></div>
        <div class="stat-card"><div class="label">This Month</div><div class="value">${Utils.formatMoney(d.month?.sales ?? 0, currency)}</div></div>
        <div class="stat-card warning"><div class="label">Low Stock</div><div class="value">${d.lowStock?.length ?? todayStats.lowStockCount ?? 0}</div></div>
        <div class="stat-card warning"><div class="label">Food Cost Alerts</div><div class="value">${foodAlerts.length}</div><small>meals over target</small></div>
        <div class="stat-card"><div class="label">Shop</div><div class="value" style="font-size:18px">${s.shop_name}</div></div>
        <div class="stat-card"><div class="label">Pending Leave</div><div class="value">${d.pendingLeave ?? 0}</div></div>
      </div>
      ${foodAlerts.length ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Food cost / margin alerts</h4>
        <p class="muted">Meals where food cost is high or profit margin is low after ingredient prices change.</p>
        <div class="table-wrap"><table><thead><tr><th>Meal</th><th>Food cost %</th><th>Margin %</th><th>Cost</th><th>Sell</th></tr></thead>
          <tbody>${foodAlerts.slice(0, 8).map(a => `<tr>
            <td>${a.name}</td><td>${a.food_cost_pct ?? 0}%</td><td>${a.profit_margin ?? 0}%</td>
            <td>${Utils.formatMoney(a.recipe_cost || 0, currency)}</td>
            <td>${Utils.formatMoney(a.selling_price || 0, currency)}</td>
          </tr>`).join('')}</tbody></table></div>
        <button type="button" class="btn btn-primary" id="admin-open-recipe" style="margin-top:10px">Open Recipe & Production</button>
      </div></div>` : ''}
    </div>`;
    document.getElementById('admin-open-recipe')?.addEventListener('click', () => {
      this.app.openRecipeProduction({ fromApp: true });
    });
  },

  async renderRecipeSection(el) {
    el.innerHTML = `<div class="admin-section">
      <h3>Recipe & Production</h3>
      <p class="muted">Same module as the kitchen Recipe system — meal recipes, capacity, restock, waste, and promotions. Colours match this Admin Panel.</p>
      <div class="card"><div class="card-body">
        <p>Open the full Recipe & Production workspace (uses your current Admin login — no second password for Owner/Manager).</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
          <button type="button" class="btn btn-primary" id="admin-rp-open">Open Recipe & Production</button>
          <button type="button" class="btn btn-ghost" id="admin-rp-export">Export recipes (branch sync)</button>
          <button type="button" class="btn btn-ghost" id="admin-rp-import">Import recipes…</button>
        </div>
        <input type="file" id="admin-rp-file" accept="application/json,.json" class="hidden">
      </div></div>
    </div>`;
    document.getElementById('admin-rp-open')?.addEventListener('click', () => {
      this.app.openRecipeProduction({ fromApp: true });
    });
    document.getElementById('admin-rp-export')?.addEventListener('click', async () => {
      const r = await API.recipeExportBundle(this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Export failed', 'error');
      const json = JSON.stringify(r.data, null, 2);
      const bytes = Array.from(new TextEncoder().encode(json));
      await API.saveFile(`recipe-bundle-${Utils.today()}.json`, [{ name: 'JSON', extensions: ['json'] }], bytes);
      Utils.toast(`Exported ${(r.data?.meals || []).length} meals`, 'success');
    });
    document.getElementById('admin-rp-import')?.addEventListener('click', () => {
      document.getElementById('admin-rp-file')?.click();
    });
    document.getElementById('admin-rp-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const r = await API.recipeImportBundle(bundle, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Import failed', 'error');
        Utils.toast(`Imported ${r.data?.imported || 0} of ${r.data?.total || 0} meals`, 'success');
      } catch (err) {
        Utils.toast(err.message || 'Invalid recipe file', 'error');
      }
      e.target.value = '';
    });
  },

  async renderPrinter(el) {
    const ps = this.settings.printer_settings || {};
    let printers = [];
    try { const pr = await API.getPrinters(); printers = pr.data || pr || []; } catch { printers = []; }

    const connOpts = (sel) => ['usb', 'bluetooth', 'network'].map(c =>
      `<option value="${c}" ${sel === c ? 'selected' : ''}>${c === 'usb' ? 'USB' : c === 'bluetooth' ? 'Bluetooth' : 'Network / Wi-Fi'}</option>`
    ).join('');
    const printerOpts = (selected) => (printers.length ? printers : [{ name: '' }]).map(p =>
      `<option value="${p.name}" ${selected === p.name ? 'selected' : ''}>${p.name || 'No printers detected'}</option>`
    ).join('');

    el.innerHTML = `<div class="admin-section"><h3>Printer Setup</h3>
      <p class="muted">Configure thermal printers for POS receipts and kitchen tickets, plus a separate <strong>A4 office printer</strong> for Reports, Bookkeeping, and every admin <strong>Print</strong> button. Connection: USB, Bluetooth, or Network.</p>
      <div class="admin-tabs" id="printer-tabs">
        <button class="admin-tab active" data-tab="receipt">Receipt (58/80mm)</button>
        <button class="admin-tab" data-tab="kitchen">Kitchen</button>
        <button class="admin-tab" data-tab="invoice">A4 Printer (Reports &amp; PDFs)</button>
        <button class="admin-tab" data-tab="barcode">Barcode Labels</button>
      </div>
      <div id="printer-tab-content"></div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="save-printer">Save Printer Settings</button>
        <button class="btn btn-ghost" id="preview-receipt">Preview Receipt</button>
        <button class="btn btn-ghost" id="preview-kitchen">Preview Kitchen</button>
        <button class="btn btn-ghost" id="preview-invoice">Preview A4 Invoice</button>
        <button class="btn btn-ghost" id="test-receipt">Test Receipt</button>
        <button class="btn btn-ghost" id="test-kitchen">Test Kitchen</button>
        <button class="btn btn-ghost" id="test-invoice">Test A4 Invoice</button>
        <button class="btn btn-ghost" id="test-barcode">Test Barcode Label</button>
      </div>
      <div id="printer-status-panel" style="margin-top:16px"></div>
    </div>`;

    const tabHtml = {
      receipt: `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Default Receipt Printer</label>
          <select id="pr-receipt">${printerOpts(ps.receipt_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pr-receipt-conn">${connOpts(ps.receipt_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
        <div class="field"><label>Paper Size (POS thermal only)</label>
          <select id="pr-paper"><option value="58mm" ${ps.paper_size === '58mm' ? 'selected' : ''}>58mm thermal</option>
          <option value="80mm" ${ps.paper_size === '80mm' || !ps.paper_size ? 'selected' : ''}>80mm thermal</option></select></div>
        <div class="field"><label>Receipt Copies</label><input type="number" id="pr-copies" min="1" max="5" value="${ps.copies || 1}"></div>
        <div class="field"><label><input type="checkbox" id="pr-autoprint" ${ps.auto_print !== false ? 'checked' : ''}> Auto-print after sale</label></div>
        <div class="field"><label><input type="checkbox" id="pr-silent" ${ps.silent_print ? 'checked' : ''}> Silent printing (no preview)</label></div>
        <div class="field"><label><input type="checkbox" id="pr-logo" ${ps.print_logo !== false ? 'checked' : ''}> Print logo</label></div>
        <div class="field"><label><input type="checkbox" id="pr-vat" ${ps.print_vat ? 'checked' : ''}> Print VAT number</label></div>
        <div class="field"><label><input type="checkbox" id="pr-cashier" ${ps.print_cashier !== false ? 'checked' : ''}> Print cashier name</label></div>
        <div class="field"><label><input type="checkbox" id="pr-drawer" ${ps.open_drawer ? 'checked' : ''}> Open cash drawer after sale</label></div>
        <div class="field"><label><input type="checkbox" id="pr-duplicate" ${ps.print_duplicate ? 'checked' : ''}> Print duplicate receipt</label></div>
      </div></div></div>`,
      kitchen: `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label><input type="checkbox" id="pr-kitchen-enabled" ${ps.kitchen_enabled !== false ? 'checked' : ''}> Enable kitchen printing</label></div>
        <div class="field"><label><input type="checkbox" id="pr-kitchen-auto" ${ps.kitchen_auto !== false ? 'checked' : ''}> Auto-print kitchen tickets when receipt prints</label></div>
        <div class="field"><label>Default Kitchen Printer</label>
          <select id="pr-kitchen">${printerOpts(ps.kitchen_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pr-kitchen-conn">${connOpts(ps.kitchen_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
        <div class="field full"><p class="muted">Kitchen tickets use 58mm or 80mm thermal paper. Food items (food, drink, combo, side) are sent to the kitchen printer automatically.</p></div>
      </div></div></div>`,
      invoice: `<div class="card"><div class="card-body">
        <div style="margin-bottom:16px;padding:16px;border-radius:10px;border:1px solid var(--border);background:var(--bg-secondary)">
          <h4 style="margin:0 0 8px">A4 Office Printer</h4>
          <p class="muted" style="margin:0">Connect a full-page printer by <strong>USB</strong> or <strong>Bluetooth</strong> (or Wi-Fi). After you Save, every <strong>Print</strong> action for Reports, Bookkeeping, invoices, payroll, routines, and admin PDFs is sent to this printer automatically.</p>
          <p class="muted" style="margin:8px 0 0">Thermal receipt and kitchen printers are unchanged — they keep using the Receipt / Kitchen tabs.</p>
        </div>
        <div class="form-grid">
        <div class="field"><label>Connected A4 Printer</label>
          <select id="pr-invoice">${printerOpts(ps.invoice_printer)}</select></div>
        <div class="field"><label>Connection type</label>
          <select id="pr-invoice-conn">${connOpts(ps.invoice_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
        <div class="field full"><p class="muted" style="margin:0">Tip: Plug the USB cable in (or pair Bluetooth), choose the connection type, click Connect, select the printer in the list, then click <strong>Save Printer Settings</strong>.</p></div>
      </div></div></div>`,
      barcode: `<div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Barcode Label Printer</label>
          <select id="pr-barcode">${printerOpts(ps.barcode_printer)}</select></div>
        <div class="field"><label>Connection</label>
          <select id="pr-barcode-conn">${connOpts(ps.barcode_connection || 'usb')}</select></div>
        <div class="field full"><div id="pr-conn-panel"></div></div>
      </div></div></div>`
    };

    let activeTab = 'receipt';
    const syncDevicePrinter = (data) => {
      const patch = {
        receipt_printer: data.receipt_printer,
        receipt_connection: data.receipt_connection,
        kitchen_printer: data.kitchen_printer,
        kitchen_connection: data.kitchen_connection,
        invoice_printer: data.invoice_printer,
        invoice_connection: data.invoice_connection,
        paper_size: data.paper_size
      };
      Utils.saveLocalDeviceSettings(patch);
      API.saveDeviceSettings(patch).catch(() => {});
    };

    const onPrinterSelected = (name, conn) => {
      const map = {
        receipt: 'pr-receipt',
        kitchen: 'pr-kitchen',
        invoice: 'pr-invoice',
        barcode: 'pr-barcode'
      };
      const sel = document.getElementById(map[activeTab]);
      if (sel && name) {
        const exists = [...sel.options].some(o => o.value === name);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        }
        sel.value = name;
      }
      if (activeTab === 'invoice' && name) {
        Utils.saveLocalDeviceSettings({
          invoice_printer: name,
          invoice_connection: conn || document.getElementById('pr-invoice-conn')?.value || 'usb'
        });
      }
    };

    const bindConnFilters = async () => {
      const configs = {
        receipt: ['pr-receipt-conn', 'pr-receipt', ps.receipt_printer, 'thermal'],
        kitchen: ['pr-kitchen-conn', 'pr-kitchen', ps.kitchen_printer, 'thermal'],
        invoice: ['pr-invoice-conn', 'pr-invoice', ps.invoice_printer, 'a4'],
        barcode: ['pr-barcode-conn', 'pr-barcode', ps.barcode_printer, 'thermal']
      };
      const cfg = configs[activeTab];
      if (cfg) {
        await PrinterUI.bindConnectionFilter(cfg[0], cfg[1], cfg[2], {
          onSelected: onPrinterSelected,
          kind: cfg[3]
        });
      }
    };
    const renderTab = async () => {
      document.getElementById('printer-tab-content').innerHTML = tabHtml[activeTab];
      document.querySelectorAll('#printer-tabs .admin-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === activeTab));
      await bindConnFilters();
      refreshStatus();
    };

    const collectData = () => ({
      receipt_printer: document.getElementById('pr-receipt')?.value || ps.receipt_printer || '',
      receipt_connection: document.getElementById('pr-receipt-conn')?.value || ps.receipt_connection || 'usb',
      paper_size: document.getElementById('pr-paper')?.value || ps.paper_size || '80mm',
      copies: parseInt(document.getElementById('pr-copies')?.value) || ps.copies || 1,
      auto_print: document.getElementById('pr-autoprint')?.checked ?? ps.auto_print !== false,
      silent_print: document.getElementById('pr-silent')?.checked ?? ps.silent_print,
      print_logo: document.getElementById('pr-logo')?.checked ?? ps.print_logo !== false,
      print_vat: document.getElementById('pr-vat')?.checked ?? ps.print_vat,
      print_cashier: document.getElementById('pr-cashier')?.checked ?? ps.print_cashier !== false,
      open_drawer: document.getElementById('pr-drawer')?.checked ?? ps.open_drawer,
      print_duplicate: document.getElementById('pr-duplicate')?.checked ?? ps.print_duplicate,
      kitchen_enabled: document.getElementById('pr-kitchen-enabled')?.checked ?? ps.kitchen_enabled !== false,
      kitchen_auto: document.getElementById('pr-kitchen-auto')?.checked ?? ps.kitchen_auto !== false,
      kitchen_printer: document.getElementById('pr-kitchen')?.value || ps.kitchen_printer || '',
      kitchen_connection: document.getElementById('pr-kitchen-conn')?.value || ps.kitchen_connection || 'usb',
      invoice_printer: document.getElementById('pr-invoice')?.value || ps.invoice_printer || '',
      invoice_connection: document.getElementById('pr-invoice-conn')?.value || ps.invoice_connection || 'usb',
      barcode_printer: document.getElementById('pr-barcode')?.value || ps.barcode_printer || '',
      barcode_connection: document.getElementById('pr-barcode-conn')?.value || ps.barcode_connection || 'usb'
    });

    const refreshStatus = async () => {
      const data = collectData();
      const st = await API.getPrinterStatus({
        receipt: data.receipt_printer,
        kitchen: data.kitchen_printer,
        invoice: data.invoice_printer
      });
      document.getElementById('printer-status-panel').innerHTML = `<div class="card"><div class="card-body">
        <h4>Printer Status (this computer)</h4>
        <div style="display:grid;gap:8px;margin-top:8px">
          <div><strong>Receipt:</strong> ${Utils.printerStatusBadge(st.receipt)}</div>
          <div><strong>Kitchen:</strong> ${Utils.printerStatusBadge(st.kitchen)}</div>
          <div><strong>A4 Printer:</strong> ${Utils.printerStatusBadge(st.invoice)}</div>
        </div></div></div>`;
    };

    document.getElementById('printer-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      const prev = collectData();
      Object.assign(ps, prev);
      activeTab = btn.dataset.tab;
      renderTab();
    });

    renderTab();

    document.getElementById('save-printer').addEventListener('click', async () => {
      const data = collectData();
      await API.saveJsonSetting('printer_settings', data, this.app.user);
      this.settings.printer_settings = data;
      if (typeof App !== 'undefined' && App.settings) App.settings.printer_settings = data;
      syncDevicePrinter(data);
      const a4 = data.invoice_printer ? ` · A4: ${data.invoice_printer}` : '';
      Utils.toast(`Printer settings saved${a4}`, 'success');
      refreshStatus();
    });

    const testSale = {
      receipt_number: 'TEST-001', created_at: new Date().toISOString(),
      cashier_name: this.app.user.full_name,
      items: [{ product_name: 'Test Burger', quantity: 1, unit_price: 45, total: 45, item_type: 'food' }],
      payments: [{ payment_type: 'cash', amount: 45 }],
      subtotal: 45, discount: 0, tax_amount: 0, total: 45, change_amount: 0
    };

    document.getElementById('test-receipt').addEventListener('click', async () => {
      const html = Receipt.build(testSale, this.settings);
      const data = collectData();
      const r = await API.printReceipt(html, {
        receiptPrinter: data.receipt_printer,
        paperSize: data.paper_size,
        silent: data.silent_print
      });
      Utils.toast(r.success ? 'Test receipt sent' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('test-kitchen').addEventListener('click', async () => {
      const html = Receipt.buildKitchenTicket(testSale, testSale.items, this.settings);
      const data = collectData();
      const r = await API.printKitchen(html, { kitchenPrinter: data.kitchen_printer, paperSize: data.paper_size });
      Utils.toast(r.success ? 'Test kitchen ticket sent' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('test-invoice').addEventListener('click', async () => {
      const html = Receipt.buildInvoice(testSale, this.settings);
      const data = collectData();
      // Prefer unsaved selection from this form so Connect → Test works before Save
      if (data.invoice_printer) {
        const r = await API.printA4(html, { invoicePrinter: data.invoice_printer, silent: true });
        if (r?.success === false) Utils.toast(r.error || 'Print failed', 'error');
        else if (r?.fallback) Utils.toast('Opened A4 preview — Save printer settings for automatic print', 'info');
        else Utils.toast(`Test sent to A4 printer: ${r.printer || data.invoice_printer}`, 'success');
      } else {
        await Utils.printToA4(html);
      }
    });
    document.getElementById('test-barcode').addEventListener('click', async () => {
      const r = await API.printBarcodeLabel({ name: 'Test Product', barcode: '8001234567890', selling_price: 29.99 });
      Utils.toast(r.success ? 'Test barcode label sent' : (r.error || 'Print failed'), r.success ? 'success' : 'error');
    });
    document.getElementById('preview-receipt').addEventListener('click', async () => {
      await API.printPreview(Receipt.build(testSale, this.settings), 'Receipt Preview');
    });
    document.getElementById('preview-kitchen').addEventListener('click', async () => {
      await API.printPreview(Receipt.buildKitchenTicket(testSale, testSale.items, this.settings), 'Kitchen Ticket Preview');
    });
    document.getElementById('preview-invoice').addEventListener('click', async () => {
      await API.printPreview(Receipt.buildInvoice(testSale, this.settings), 'A4 Invoice Preview');
    });
  },

  renderReceiptDesigner(el) {
    const rd = this.settings.receipt_design || {};
    el.innerHTML = `<div class="admin-section"><h3>Receipt Designer & Numbering</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Receipt Prefix</label><input id="rd-prefix" value="${rd.receipt_prefix || 'RCP'}" placeholder="RCP"></div>
        <div class="field"><label>Receipt Number Padding</label><input type="number" id="rd-pad" min="1" max="10" value="${rd.receipt_number_pad || 5}"></div>
        <div class="field full"><label><input type="checkbox" id="rd-inc-date" ${rd.receipt_include_date !== false ? 'checked' : ''}> Include date in receipt number (e.g. RCP-20260803-00001)</label></div>
        <div class="field"><label>Order Number Prefix</label><input id="rd-order-prefix" value="${rd.order_prefix || 'ORD'}" placeholder="ORD"></div>
        <div class="field"><label>Order Number Padding</label><input type="number" id="rd-order-pad" min="1" max="10" value="${rd.order_number_pad || 4}"></div>
        <div class="field full"><label><input type="checkbox" id="rd-order-date" ${rd.order_include_date !== false ? 'checked' : ''}> Include date in order number (shown on receipts, kitchen & customer display, WhatsApp)</label></div>
        <div class="field full"><label><input type="checkbox" id="rd-item-tax" ${rd.show_item_tax !== false ? 'checked' : ''}> Show per-item excl. tax + tax on receipt when VAT enabled</label></div>
        <div class="field"><label><input type="checkbox" id="rd-logo" ${rd.show_logo!==false?'checked':''}> Show logo</label></div>
        <div class="field"><label><input type="checkbox" id="rd-address" ${rd.show_address!==false?'checked':''}> Show address</label></div>
        <div class="field"><label><input type="checkbox" id="rd-phone" ${rd.show_phone!==false?'checked':''}> Show phone</label></div>
        <div class="field"><label><input type="checkbox" id="rd-email" ${rd.show_email?'checked':''}> Show email</label></div>
        <div class="field"><label><input type="checkbox" id="rd-vat" ${rd.show_vat?'checked':''}> Show VAT number</label></div>
        <div class="field"><label><input type="checkbox" id="rd-cashier" ${rd.show_cashier!==false?'checked':''}> Show cashier</label></div>
        <div class="field full"><label>Thank You Message</label>
          <input id="rd-thanks" value="${rd.thank_you || this.settings.thank_you_message || 'THANK YOU FOR SHOPPING WITH US'}"></div>
        <div class="field full"><label>Footer Message</label>
          <input id="rd-footer" value="${rd.footer_message || this.settings.receipt_footer || 'Please Come Again'}"></div>
        <div class="field full"><label>Return Policy</label>
          <textarea id="rd-return" rows="2">${rd.return_policy || this.settings.return_policy || ''}</textarea></div>
        <div class="field full"><label>Custom Notes</label>
          <textarea id="rd-notes" rows="2">${rd.custom_notes || ''}</textarea></div>
      </div>
      <button class="btn btn-primary" id="save-receipt-design" style="margin-top:16px">Save Receipt Design</button>
      </div></div></div>`;

    document.getElementById('save-receipt-design').addEventListener('click', async () => {
      const rd = {
        receipt_prefix: document.getElementById('rd-prefix').value.trim() || 'RCP',
        receipt_number_pad: parseInt(document.getElementById('rd-pad').value, 10) || 5,
        receipt_include_date: document.getElementById('rd-inc-date').checked,
        order_prefix: document.getElementById('rd-order-prefix').value.trim() || 'ORD',
        order_number_pad: parseInt(document.getElementById('rd-order-pad').value, 10) || 4,
        order_include_date: document.getElementById('rd-order-date').checked,
        show_item_tax: document.getElementById('rd-item-tax').checked,
        show_logo: document.getElementById('rd-logo').checked,
        show_address: document.getElementById('rd-address').checked,
        show_phone: document.getElementById('rd-phone').checked,
        show_email: document.getElementById('rd-email').checked,
        show_vat: document.getElementById('rd-vat').checked,
        show_cashier: document.getElementById('rd-cashier').checked,
        thank_you: document.getElementById('rd-thanks').value.trim(),
        footer_message: document.getElementById('rd-footer').value.trim(),
        return_policy: document.getElementById('rd-return').value.trim(),
        custom_notes: document.getElementById('rd-notes').value.trim()
      };
      await API.saveJsonSetting('receipt_design', rd, this.app.user);
      await API.saveSettings({
        thank_you_message: rd.thank_you,
        receipt_footer: rd.footer_message,
        return_policy: rd.return_policy
      }, this.app.user);
      Utils.toast('Receipt design saved', 'success');
    });
  },

  renderSecurity(el) {
    const sec = this.settings.security_settings || {};
    const isOwner = this.app.user?.role === 'owner';
    const canCodes = ['owner', 'manager'].includes(this.app.user?.role);
    el.innerHTML = `<div class="admin-section"><h3>Security Settings</h3>
      <div class="card"><div class="card-body">
        <h4>Notification & Closing Sound</h4>
        <p class="muted">Alert sound loops for unread alerts until marked read. Pending settings approvals appear in the bell but do not trigger the sound.</p>
        ${(() => {
          const ns = this.settings.notification_settings || {};
          return `<div class="form-grid">
            <div class="field full"><label><input type="checkbox" id="ns-enabled" ${ns.sound_enabled!==false?'checked':''}> Enable alert sounds</label></div>
            <div class="field full"><label><input type="checkbox" id="ns-loop" ${ns.loop_until_read!==false?'checked':''}> Loop sound until attended</label></div>
            <div class="field full"><label>Current sound</label><span class="muted" id="ns-current-label">${ns.sound_path ? ns.sound_path.split(/[/\\]/).pop() : 'Demo sound (built-in)'}</span></div>
          </div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            <button type="button" class="btn btn-warning" id="ns-test">Test Sound</button>
            <button type="button" class="btn btn-ghost hidden" id="ns-test-stop">Stop Test</button>
            <button type="button" class="btn btn-ghost" id="ns-test-notif">Send Test Notification</button>
            <button type="button" class="btn btn-ghost" id="ns-upload">Upload Custom Sound</button>
            <button type="button" class="btn btn-ghost" id="ns-demo">Use Demo Sound</button>
          </div>
          <p class="muted" style="margin-top:8px;font-size:12px">Test Sound plays an 8-second preview. You can also test from the bell icon (Notifications).</p>
          <button type="button" class="btn btn-primary" id="save-notif-sound" style="margin-top:12px">Save Notification Settings</button>`;
        })()}
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Auto Logout (minutes)</label>
          <input type="number" id="sec-logout" min="0" value="${sec.auto_logout_minutes||30}"></div>
        <div class="field"><label><input type="checkbox" id="sec-lock" ${sec.lock_after_inactivity!==false?'checked':''}> Lock after inactivity</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-refund" ${sec.require_approval_refunds!==false?'checked':''}> Require supervisor code for cashier returns</label></div>
        <div class="field"><label>Cashier return limit (R)</label><input type="number" id="sec-ret-cashier" step="0.01" value="${sec.return_cashier_max??100}"></div>
        <div class="field"><label>Manager return limit (R)</label><input type="number" id="sec-ret-manager" step="0.01" value="${sec.return_manager_max??1000}"></div>
        <div class="field full"><label><input type="checkbox" id="sec-discount" ${sec.require_approval_discounts?'checked':''}> Require manager approval for discounts</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-oversell" ${sec.allow_oversell?'checked':''}> Allow oversell (sell when stock is zero)</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-price" ${sec.require_approval_price!==false?'checked':''}> Require manager approval for price changes</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-stock" ${sec.require_approval_stock!==false?'checked':''}> Require manager approval for stock adjustments</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-drawer" ${sec.require_approval_drawer!==false?'checked':''}> Require manager approval to open cash drawer</label></div>
        <div class="field full"><label><input type="checkbox" id="sec-shift-login" ${sec.shift_login_enforcement?'checked':''}> Block POS login for employees not on today's shift (Staff Portal still opens; clock-in still requires a shift. Admin / manager / supervisor always allowed)</label></div>
      </div>
      <button class="btn btn-primary" id="save-security" style="margin-top:16px">Save Security Settings</button>
      </div></div>
      ${isOwner ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Bookkeeping Access Password</h4>
        <p class="muted">Set a separate password required to open the Bookkeeping module. Leave blank to keep current password.</p>
        <div class="form-grid">
          <div class="field"><label>New Bookkeeping Password</label><input type="password" id="sec-bk-pass" autocomplete="new-password"></div>
          <div class="field"><label>Confirm Password</label><input type="password" id="sec-bk-pass2" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-warning" id="save-bk-pass" style="margin-top:8px">Save Bookkeeping Password</button>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Account Recovery</h4>
        <p class="muted">Create a Private Recovery Phrase known only to the shop owner. If you forget the owner password, use Login → Account Recovery. The phrase is stored as a one-way hash — it is never shown again, never logged, and never sent back by the server.</p>
        <p><strong>Status:</strong> ${sec.recovery_configured
          ? '<span class="tag tag-ok">Configured</span>'
          : '<span class="tag tag-warn">Not configured</span>'}</p>
        <p class="muted">Last changed: ${sec.recovery_changed_at ? Utils.formatDateTime(sec.recovery_changed_at) : '—'}</p>
        <div class="form-grid" style="margin-top:12px">
          <div class="field full"><label>${sec.recovery_configured ? 'Change' : 'Create'} Private Recovery Phrase <span class="muted">(min 8 characters)</span></label>
            <input type="password" id="sec-recovery" autocomplete="new-password" placeholder="A sentence only you will remember"></div>
          <div class="field full"><label>Confirm Recovery Phrase</label>
            <input type="password" id="sec-recovery-confirm" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-warning" id="save-recovery" style="margin-top:8px">${sec.recovery_configured ? 'Change Recovery Phrase' : 'Create Private Recovery Phrase'}</button>
      </div></div>` : ''}
      ${canCodes ? `<div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Daily Supervisor Code (Void & Returns)</h4>
        <p class="muted">Generate a code each day. Regenerating invalidates the previous code immediately. Send to manager/supervisor WhatsApp.</p>
        <div id="supervisor-code-display" style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">—</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-warning" id="gen-supervisor-code">Generate Today's Code (Void)</button>
          <button class="btn btn-ghost" id="wa-supervisor-code">Send WhatsApp</button>
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <h4>Daily Refund Authorization Code</h4>
        <p class="muted">Required for cashier refunds. Regenerating blocks old codes until the new PIN is shared.</p>
        <div id="refund-code-display" style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">—</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-warning" id="gen-refund-code">Generate Today's Refund Code</button>
          <button class="btn btn-ghost" id="wa-refund-code">Send WhatsApp</button>
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <h4>Daily Supervisor Code (Staff Portal)</h4>
        <p class="muted">Cashiers need this code to unlock Staff. Regenerating invalidates the previous code.</p>
        <div id="staff-code-display" style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">—</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-warning" id="gen-staff-code">Generate Staff Portal Code</button>
          <button class="btn btn-ghost" id="wa-staff-code">Send WhatsApp</button>
        </div>
        <div class="field" style="margin-top:16px;max-width:320px">
          <label>Manager / Supervisor WhatsApp number</label>
          <input id="sec-code-wa-phone" placeholder="e.g. 0821234567" value="${(sec.code_whatsapp_phone || this.settings.phone || '').replace(/"/g, '')}">
        </div>
      </div></div>` : '<p class="muted" style="margin-top:16px">Daily codes are available to owners and managers.</p>'}
      </div>`;

    const loadCode = async () => {
      if (!canCodes) return;
      const r = await API.getTodaySupervisorCode(this.app.user, 'void');
      const el = document.getElementById('supervisor-code-display');
      if (!el) return;
      if (r.success && r.data?.code) el.textContent = r.data.code;
      else el.textContent = 'No code generated today';
      const rr = await API.getTodaySupervisorCode(this.app.user, 'refund');
      const rel = document.getElementById('refund-code-display');
      if (rel) rel.textContent = rr.success && rr.data?.code ? rr.data.code : 'No code generated today';
      const sr = await API.getTodaySupervisorCode(this.app.user, 'staff');
      const sel = document.getElementById('staff-code-display');
      if (sel) sel.textContent = sr.success && sr.data?.code ? sr.data.code : 'No code generated today';
    };
    loadCode();

    const sendCodeWhatsApp = async (purpose, label) => {
      const phone = document.getElementById('sec-code-wa-phone')?.value.trim() || this.settings.phone;
      if (!phone) return Utils.toast('Enter manager/supervisor WhatsApp number', 'error');
      const codeEl = purpose === 'void' ? 'supervisor-code-display' : purpose === 'refund' ? 'refund-code-display' : 'staff-code-display';
      let code = document.getElementById(codeEl)?.textContent?.trim();
      if (!code || code.includes('No code') || code === '—') {
        const gen = await API.generateSupervisorCode(this.app.user, purpose);
        if (!gen.success) return Utils.toast(gen.error, 'error');
        code = gen.data.code;
        document.getElementById(codeEl).textContent = code;
      }
      const body = `${this.settings.shop_name || 'Shop POS'} — ${label}\nDate: ${Utils.today()}\nPIN: ${code}\n\nPrevious PIN is no longer valid.`;
      const wa = await API.sendWhatsAppMessage({
        phone,
        recipient_name: 'Supervisor',
        message_type: 'supervisor_code',
        body
      }, this.app.user);
      await Utils.deliverWhatsApp(wa, phone, body);
    };

    document.getElementById('gen-supervisor-code')?.addEventListener('click', async () => {
      const r = await API.generateSupervisorCode(this.app.user, 'void');
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('supervisor-code-display').textContent = r.data.code;
      Utils.toast(`New void code generated — old code no longer works`, 'success');
    });

    document.getElementById('gen-refund-code')?.addEventListener('click', async () => {
      const r = await API.generateSupervisorCode(this.app.user, 'refund');
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('refund-code-display').textContent = r.data.code;
      Utils.toast(`New refund code generated — old code no longer works`, 'success');
    });

    document.getElementById('gen-staff-code').addEventListener('click', async () => {
      const r = await API.generateSupervisorCode(this.app.user, 'staff');
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('staff-code-display').textContent = r.data.code;
      Utils.toast(`New staff code generated — old code no longer works`, 'success');
    });
    document.getElementById('wa-supervisor-code')?.addEventListener('click', () => sendCodeWhatsApp('void', 'Daily Void / Returns PIN'));
    document.getElementById('wa-refund-code')?.addEventListener('click', () => sendCodeWhatsApp('refund', 'Daily Refund Authorization PIN'));
    document.getElementById('wa-staff-code')?.addEventListener('click', () => sendCodeWhatsApp('staff', 'Daily Staff Portal PIN'));

    document.getElementById('save-security').addEventListener('click', async () => {
      const existing = this.settings.security_settings || {};
      await API.saveJsonSetting('security_settings', {
        ...existing,
        auto_logout_minutes: parseInt(document.getElementById('sec-logout').value) || 30,
        lock_after_inactivity: document.getElementById('sec-lock').checked,
        require_approval_refunds: document.getElementById('sec-refund').checked,
        return_cashier_max: parseFloat(document.getElementById('sec-ret-cashier').value) || 100,
        return_manager_max: parseFloat(document.getElementById('sec-ret-manager').value) || 1000,
        require_approval_discounts: document.getElementById('sec-discount').checked,
        allow_oversell: !!document.getElementById('sec-oversell')?.checked,
        require_approval_price: document.getElementById('sec-price').checked,
        require_approval_stock: document.getElementById('sec-stock').checked,
        require_approval_drawer: document.getElementById('sec-drawer').checked,
        shift_login_enforcement: document.getElementById('sec-shift-login').checked,
        code_whatsapp_phone: document.getElementById('sec-code-wa-phone')?.value.trim() || ''
      }, this.app.user);
      this.settings.security_settings = {
        ...(this.settings.security_settings || {}),
        require_approval_discounts: document.getElementById('sec-discount').checked,
        allow_oversell: !!document.getElementById('sec-oversell')?.checked,
        require_approval_drawer: document.getElementById('sec-drawer').checked
      };
      if (this.app) this.app.settings = { ...this.app.settings, security_settings: { ...(this.app.settings?.security_settings || {}), ...this.settings.security_settings } };
      Utils.toast('Security settings saved', 'success');
    });

    document.getElementById('save-bk-pass')?.addEventListener('click', async () => {
      const p1 = document.getElementById('sec-bk-pass').value;
      const p2 = document.getElementById('sec-bk-pass2').value;
      if (!p1) return Utils.toast('Enter a bookkeeping password', 'error');
      if (p1 !== p2) return Utils.toast('Passwords do not match', 'error');
      const r = await API.setBookkeepingPassword(p1, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      document.getElementById('sec-bk-pass').value = '';
      document.getElementById('sec-bk-pass2').value = '';
      Utils.toast('Bookkeeping password saved', 'success');
    });

    document.getElementById('ns-upload')?.addEventListener('click', async () => {
      const r = await API.selectAudio('notification');
      if (r?.cancelled) return;
      if (!r?.success) return Utils.toast(r?.error || 'Upload failed', 'error');
      this._pendingSoundPath = r.path;
      Utils.toast('Sound uploaded — click Save Notification Settings', 'success');
    });

    document.getElementById('ns-demo')?.addEventListener('click', async () => {
      const r = await API.ensureDemoNotificationSound();
      if (!r?.success) return Utils.toast(r?.error || 'Demo sound unavailable', 'error');
      this._pendingSoundPath = r.data?.sound_path;
      Utils.toast('Demo sound selected — click Save Notification Settings', 'success');
    });

    const getNotifTestSettings = () => ({
      ...this.settings,
      notification_settings: {
        ...(this.settings.notification_settings || {}),
        sound_enabled: document.getElementById('ns-enabled').checked,
        loop_until_read: document.getElementById('ns-loop').checked,
        sound_path: this._pendingSoundPath ?? (this.settings.notification_settings || {}).sound_path
      }
    });

    document.getElementById('ns-test')?.addEventListener('click', async () => {
      const testSettings = getNotifTestSettings();
      if (!SoundService.isEnabled(testSettings)) return Utils.toast('Enable alert sounds first', 'error');
      try {
        await API.ensureDemoNotificationSound();
        const fresh = await API.getSettingsParsed();
        if (fresh.success) {
          this.settings = fresh.data;
          this.app.settings = fresh.data;
        }
        await SoundService.testAlert(getNotifTestSettings());
        document.getElementById('ns-test-stop')?.classList.remove('hidden');
        Utils.toast('Playing test sound for 8 seconds…', 'success');
      } catch (err) {
        Utils.toast(err.message || 'Could not play sound', 'error');
      }
    });

    document.getElementById('ns-test-stop')?.addEventListener('click', () => {
      SoundService.stopAlert();
      document.getElementById('ns-test-stop')?.classList.add('hidden');
      Utils.toast('Test sound stopped', 'success');
    });

    document.getElementById('ns-test-notif')?.addEventListener('click', async () => {
      const r = await API.createTestNotification();
      if (!r?.success) return Utils.toast(r?.error || 'Could not create test notification', 'error');
      Utils.toast('Test notification sent — check the bell icon', 'success');
      this.app.loadNotifications();
      this.app.checkNotificationSounds();
    });

    document.getElementById('save-notif-sound')?.addEventListener('click', async () => {
      const ns = {
        ...(this.settings.notification_settings || {}),
        sound_enabled: document.getElementById('ns-enabled').checked,
        loop_until_read: document.getElementById('ns-loop').checked
      };
      if (this._pendingSoundPath) ns.sound_path = this._pendingSoundPath;
      await API.saveJsonSetting('notification_settings', ns, this.app.user);
      this.settings.notification_settings = ns;
      this.app.settings = { ...this.app.settings, notification_settings: ns };
      Utils.toast('Notification sound settings saved', 'success');
      this.renderSecurity(el);
    });

    document.getElementById('save-recovery')?.addEventListener('click', async () => {
      const phrase = document.getElementById('sec-recovery').value;
      const phrase2 = document.getElementById('sec-recovery-confirm')?.value || document.getElementById('sec-recovery2')?.value;
      if (!phrase || phrase.length < 8) return Utils.toast('Recovery phrase must be at least 8 characters', 'error');
      if (phrase !== phrase2) return Utils.toast('Recovery phrases do not match', 'error');
      const r = await API.setRecoverySecret(phrase, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not save recovery phrase', 'error');
      document.getElementById('sec-recovery').value = '';
      const confirmEl = document.getElementById('sec-recovery-confirm') || document.getElementById('sec-recovery2');
      if (confirmEl) confirmEl.value = '';
      const fresh = await API.getSettingsParsed();
      if (fresh?.success && fresh.data) {
        this.settings = fresh.data;
        if (this.app) this.app.settings = fresh.data;
      }
      Utils.toast('Private recovery phrase saved. Keep it secret — write it down somewhere safe. It will not be shown again.', 'success');
      this.renderSecurity(el);
    });
  },

  async renderSettingsApprovals(el) {
    const canReview = ['owner', 'manager'].includes(this.app.user?.role);
    const [pendingRes, histRes, wastePendingRes, wasteAllRes] = await Promise.all([
      API.getPendingSettingsRequests(),
      API.getSettingsRequestHistory ? API.getSettingsRequestHistory(40) : Promise.resolve({ success: true, data: [] }),
      API.recipeWasteList ? API.recipeWasteList({ status: 'pending' }, this.app.user) : Promise.resolve({ success: true, data: [] }),
      API.recipeWasteList ? API.recipeWasteList({}, this.app.user) : Promise.resolve({ success: true, data: [] })
    ]);
    const pending = pendingRes.data || [];
    const allSettingsHist = histRes.data || [];
    const history = allSettingsHist.filter(r => r.status !== 'pending').slice(0, 25);
    const wastePending = (wastePendingRes.success ? (wastePendingRes.data || []) : []).filter(w => w.status === 'pending');
    const wasteHistory = (wasteAllRes.success ? (wasteAllRes.data || []) : []).filter(w => w.status !== 'pending').slice(0, 25);
    const parseReq = (r) => {
      try { return typeof r?.settings_json === 'string' ? JSON.parse(r.settings_json || '{}') : (r?.settings_json || {}); }
      catch { return {}; }
    };
    const wasteRow = (w, pendingOnly) => `<tr>
      <td class="adm-waste-thumb" data-path="${Utils.escHtml(w.photo_path || '')}">${w.photo_path ? '…' : '—'}</td>
      <td>${Utils.formatDateTime(w.created_at)}</td>
      <td>${w.recorded_by_name || '—'}</td>
      <td>${w.waste_type || '—'}</td>
      <td>${w.product_name || '—'}</td>
      <td>${w.quantity} ${w.unit || ''}</td>
      <td>${Utils.formatMoney(w.cost)}</td>
      ${pendingOnly ? '' : `<td><span class="tag">${w.status}</span></td>`}
      <td class="actions">
        ${pendingOnly && canReview ? `<button class="btn btn-sm btn-success appr-waste" data-id="${w.id}">Approve</button>
        <button class="btn btn-sm btn-danger rej-waste" data-id="${w.id}">Reject</button>` : ''}
        <button class="btn btn-sm btn-ghost view-waste" data-id="${w.id}" data-scope="${pendingOnly ? 'pending' : 'hist'}">View</button>
        ${canReview ? `<button class="btn btn-sm btn-danger del-waste" data-id="${w.id}">Delete</button>` : ''}
      </td></tr>`;
    el.innerHTML = `<div class="admin-section"><h3>Settings Change Requests</h3>
      <p class="muted">Staff and managers can propose shop settings from Settings. Approve to apply, or reject.</p>
      ${!canReview ? '<p class="muted" style="color:var(--warning)">Only owner/manager can approve.</p>' : ''}
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Pending (${pending.length})</h4></div><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Requested By</th><th>Changes</th><th></th></tr></thead>
        <tbody>${pending.length ? pending.map(r => {
          const data = parseReq(r);
          const summary = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ').slice(0, 120);
          return `<tr><td>${Utils.formatDateTime(r.created_at)}</td><td>${r.requested_by_name || '—'}</td>
            <td><small>${summary || '—'}</small></td>
            <td class="actions">
              ${canReview ? `<button class="btn btn-sm btn-success appr-req" data-id="${r.id}">Approve</button>
              <button class="btn btn-sm btn-danger rej-req" data-id="${r.id}">Reject</button>
              <button class="btn btn-sm btn-ghost edit-req" data-id="${r.id}">Edit</button>
              <button class="btn btn-sm btn-danger del-req" data-id="${r.id}">Delete</button>` : ''}
              <button class="btn btn-sm btn-ghost view-req" data-id="${r.id}">View</button>
            </td></tr>`;
        }).join('') : '<tr><td colspan="4" class="muted">No pending requests</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Recipe Waste Approvals (${wastePending.length})</h4></div>
        <p class="muted" style="padding:0 16px">Waste from Recipe &amp; Production — photo attaches here for View / Approve.</p>
        <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Date</th><th>By</th><th>Type</th><th>Item</th><th>Qty</th><th>Cost</th><th></th></tr></thead>
        <tbody>${wastePending.length ? wastePending.map(w => wasteRow(w, true)) : '<tr><td colspan="8" class="muted">No pending waste requests</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Settings history (${history.length})</h4></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>By</th><th>Status</th><th>Reviewed</th><th></th></tr></thead>
        <tbody>${history.length ? history.map(r => `<tr>
          <td>${Utils.formatDateTime(r.created_at)}</td><td>${r.requested_by_name || '—'}</td>
          <td><span class="tag">${r.status}</span></td>
          <td>${r.reviewed_by_name || '—'} ${r.reviewed_at ? Utils.formatDateTime(r.reviewed_at) : ''}</td>
          <td class="actions">
            <button class="btn btn-sm btn-ghost view-hist-req" data-id="${r.id}">View</button>
            ${canReview ? `<button class="btn btn-sm btn-danger del-req" data-id="${r.id}">Delete</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">No history yet</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-header"><h4>Waste history (${wasteHistory.length})</h4></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Date</th><th>By</th><th>Type</th><th>Item</th><th>Qty</th><th>Cost</th><th>Status</th><th></th></tr></thead>
        <tbody>${wasteHistory.length ? wasteHistory.map(w => wasteRow(w, false)) : '<tr><td colspan="9" class="muted">No waste history</td></tr>'}
        </tbody></table></div></div>
      </div>`;

    el.querySelectorAll('.adm-waste-thumb[data-path]').forEach(async (cell) => {
      const path = cell.getAttribute('data-path');
      if (!path) return;
      try {
        const img = await API.getImageDataUrl(path);
        if (img.success && (img.dataUrl || img.data)) {
          cell.innerHTML = `<img src="${img.dataUrl || img.data}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`;
        } else cell.textContent = '📷';
      } catch (_) { cell.textContent = '📷'; }
    });

    el.querySelectorAll('.appr-req').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Apply these settings now?')) return;
      const r = await API.approveSettingsRequest(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed', 'error');
      Utils.toast('Settings approved and applied', 'success');
      const settingsRes = await API.getSettingsParsed();
      if (settingsRes.success) { this.settings = settingsRes.data; this.app.settings = settingsRes.data; this.app.updateBranding(); this.app.applyTheme(); }
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.rej-req').forEach(b => b.addEventListener('click', async () => {
      const notes = prompt('Reason for rejection (optional):') || '';
      const r = await API.rejectSettingsRequest(parseInt(b.dataset.id, 10), notes, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Request rejected', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.view-req, .view-hist-req').forEach(b => b.addEventListener('click', () => {
      const req = pending.find(x => x.id == b.dataset.id) || allSettingsHist.find(x => x.id == b.dataset.id);
      const data = parseReq(req);
      Utils.showModal('Requested Changes', `<pre style="white-space:pre-wrap;font-size:13px">${JSON.stringify(data, null, 2)}</pre>`,
        '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    }));
    el.querySelectorAll('.edit-req').forEach(b => b.addEventListener('click', () => {
      const req = pending.find(x => x.id == b.dataset.id);
      if (!req) return;
      const data = parseReq(req);
      Utils.showModal('Edit settings request', `
        <p class="muted">Edit JSON carefully — invalid JSON will not save.</p>
        <textarea id="adm-edit-settings-json" rows="14" style="width:100%;font-family:monospace;font-size:12px">${JSON.stringify(data, null, 2)}</textarea>
      `, '<button class="btn btn-primary" id="adm-save-settings-req">Save</button>');
      document.getElementById('adm-save-settings-req').onclick = async () => {
        let parsed;
        try { parsed = JSON.parse(document.getElementById('adm-edit-settings-json').value); }
        catch { return Utils.toast('Invalid JSON', 'error'); }
        const r = await API.updateSettingsRequest(req.id, parsed, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Update failed', 'error');
        Utils.hideModal();
        Utils.toast('Request updated', 'success');
        this.renderSettingsApprovals(el);
      };
    }));
    el.querySelectorAll('.del-req').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this settings request from history?')) return;
      const r = await API.deleteSettingsRequest(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Delete failed', 'error');
      Utils.toast('Deleted', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.appr-waste').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Approve this waste and deduct stock?')) return;
      const r = await API.recipeWasteApprove(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Approve failed', 'error');
      Utils.toast('Waste approved — stock deducted', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.rej-waste').forEach(b => b.addEventListener('click', async () => {
      const r = await API.recipeWasteReject(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Reject failed', 'error');
      Utils.toast('Waste request rejected', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.del-waste').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this waste record?')) return;
      const r = await API.recipeWasteDelete(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Delete failed', 'error');
      Utils.toast('Waste record deleted', 'success');
      this.renderSettingsApprovals(el);
    }));
    el.querySelectorAll('.view-waste').forEach(b => b.addEventListener('click', async () => {
      const scope = b.dataset.scope === 'hist' ? wasteHistory : wastePending;
      const w = scope.find(x => Number(x.id) === Number(b.dataset.id))
        || wastePending.find(x => Number(x.id) === Number(b.dataset.id))
        || wasteHistory.find(x => Number(x.id) === Number(b.dataset.id));
      if (!w) return;
      let photoHtml = '<p class="muted">No photo attached</p>';
      if (w.photo_path) {
        try {
          const img = await API.getImageDataUrl(w.photo_path);
          if (img.success && (img.dataUrl || img.data)) {
            photoHtml = `<img src="${img.dataUrl || img.data}" alt="Waste" style="max-width:100%;max-height:360px;border-radius:8px;border:1px solid var(--border)">`;
          }
        } catch (_) {}
      }
      Utils.showModal('Waste request details', `
        <div style="display:grid;gap:8px;font-size:14px">
          <div><strong>Type:</strong> ${w.waste_type || '—'}</div>
          <div><strong>Item:</strong> ${w.product_name || '—'}</div>
          <div><strong>Qty:</strong> ${w.quantity} ${w.unit || ''}</div>
          <div><strong>Cost:</strong> ${Utils.formatMoney(w.cost)}</div>
          <div><strong>Reason:</strong> ${w.reason || '—'}</div>
          <div><strong>Status:</strong> ${w.status}</div>
          <div><strong>Recorded by:</strong> ${w.recorded_by_name || '—'}</div>
          <div><strong>When:</strong> ${Utils.formatDateTime(w.created_at)}</div>
          <div style="margin-top:8px"><strong>Attached photo</strong></div>
          ${photoHtml}
        </div>
      `, '<button class="btn btn-ghost" onclick="Utils.hideModal()">Close</button>');
    }));
  },

  async renderPermissions(el) {
    const usersRes = await API.getUsers(this.app.user);
    const users = usersRes.data || [];
    const active = users.filter(u => u.is_active);
    const inactive = users.filter(u => !u.is_active);

    const userRow = (u) => {
      let perms = {};
      try { perms = JSON.parse(u.permissions || '{}'); } catch {}
      const isSelf = u.id === this.app.user?.id;
      return `<tr><td>${u.full_name}</td><td>${u.username}</td><td>${Utils.roleTag(u.role)}</td>
        <td>${u.is_active ? '<span class="tag success">Active</span>' : '<span class="tag">Inactive</span>'}</td>
        <td><small>${Object.keys(perms).filter(k=>perms[k]).join(', ') || 'Default role permissions'}</small></td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-ghost edit-user" data-id="${u.id}">Edit</button>
          ${!isSelf && u.is_active ? `<button class="btn btn-sm btn-warning del-user" data-id="${u.id}">Deactivate</button>` : ''}
          ${!isSelf && !u.is_active ? `<button class="btn btn-sm btn-primary restore-user" data-id="${u.id}">Restore</button>` : ''}
          ${!isSelf ? `<button class="btn btn-sm btn-danger purge-user" data-id="${u.id}">Delete permanently</button>` : ''}
        </td></tr>`;
    };

    el.innerHTML = `<div class="admin-section"><h3>Users & Permissions</h3>
      <div style="margin-bottom:12px"><button class="btn btn-primary" id="admin-add-user">+ Add User</button></div>
      <h4>Active Users</h4>
      <div class="card" style="margin-bottom:16px"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th>Permissions</th><th></th></tr></thead>
        <tbody>${active.map(userRow).join('') || '<tr><td colspan="6" class="muted">No active users</td></tr>'}</tbody>
      </table></div></div>
      <h4>Inactive Users</h4>
      <div class="card" style="margin-bottom:16px"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th>Permissions</th><th></th></tr></thead>
        <tbody>${inactive.map(userRow).join('') || '<tr><td colspan="6" class="muted">No inactive users</td></tr>'}</tbody>
      </table></div></div>
      <div class="card"><div class="card-body">
        <h4>Default Role Access</h4>
        <p><strong>Owner:</strong> Full access to everything</p>
        <p><strong>Manager:</strong> Reports, stock, ops — <em>Staff Portal</em> and extra pages need explicit permission</p>
        <p><strong>Assistant Manager:</strong> Access granted per permission checkbox only</p>
        <p><strong>Marketing Agent:</strong> Marketing & flyers page only</p>
        <p><strong>Cashier:</strong> POS only by default — grant <em>Process returns</em> for Returns, and <em>Staff Portal</em> for the sidebar Staff Portal</p>
        <p class="muted" style="margin-top:8px">Staff UIF/PAYE/SDL only apply after you enable them under Payroll <strong>and</strong> mark each employee as registered on their HR profile. Owner salary needs both Payroll enable and the Owner Salary checkboxes.</p>
      </div></div></div>`;

    const refresh = () => this.renderPermissions(el);
    document.getElementById('admin-add-user')?.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.showForm(null, refresh);
    });
    el.querySelectorAll('.edit-user').forEach(b => b.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.showForm(users.find(u => u.id == b.dataset.id), refresh);
    }));
    el.querySelectorAll('.del-user').forEach(b => b.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.deactivateUser(users.find(u => u.id == b.dataset.id), refresh);
    }));
    el.querySelectorAll('.purge-user').forEach(b => b.addEventListener('click', () => {
      UsersPage.app = this.app;
      UsersPage.permanentlyDeleteUser(users.find(u => u.id == b.dataset.id), refresh);
    }));
    el.querySelectorAll('.restore-user').forEach(b => b.addEventListener('click', async () => {
      const r = await API.updateUser(parseInt(b.dataset.id, 10), { is_active: true }, this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Restore failed', 'error');
      Utils.toast('User restored', 'success');
      refresh();
    }));
  },

  renderTaxCurrency(el) {
    const s = this.settings;
    const showOnPos = s.tax_show_on_pos !== 0 && s.tax_show_on_pos !== false && s.tax_show_on_pos !== '0';
    el.innerHTML = `<div class="admin-section"><h3>Tax & Currency Settings</h3>
      <p class="muted">Turn tax on for sales and stock purchases. Choose whether it appears on the POS screen and receipts.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label><input type="checkbox" id="tax-enabled" ${s.tax_enabled?'checked':''}> Enable VAT/Tax (calculate on sales &amp; purchases)</label></div>
        <div class="field"><label><input type="checkbox" id="tax-show-pos" ${showOnPos?'checked':''}> Show tax on POS &amp; receipts</label></div>
        <div class="field"><label>VAT Percentage</label><input type="number" id="tax-rate" step="0.1" value="${s.tax_rate||0}"></div>
        <div class="field"><label><input type="checkbox" id="tax-inclusive" ${s.tax_inclusive?'checked':''}> Tax inclusive pricing</label></div>
        <div class="field"><label>VAT Number</label><input id="vat-num" value="${s.vat_number||''}"></div>
        <div class="field"><label>Currency Symbol</label><input id="cur-symbol" value="${s.currency||'R'}"></div>
        <div class="field"><label>Currency Name</label><input id="cur-name" value="${s.currency_name||'Rand'}"></div>
        <div class="field"><label>Decimal Places</label><input type="number" id="cur-dec" min="0" max="4" value="${s.decimal_places??2}"></div>
        <div class="field"><label>Thousands Separator</label>
          <select id="cur-sep"><option value="," ${s.thousands_sep===','?'selected':''}>Comma (,)</option>
          <option value=" " ${s.thousands_sep===' '?'selected':''}>Space</option>
          <option value="." ${s.thousands_sep==='.'?'selected':''}>Period (.)</option></select></div>
      </div>
      <button class="btn btn-primary" id="save-tax" style="margin-top:16px">Save Tax & Currency</button>
      <p class="muted" style="margin-top:12px">See <strong>Tax Calculations</strong> for sales VAT, purchase VAT, and bookkeeping link.</p>
      </div></div></div>`;

    document.getElementById('save-tax').addEventListener('click', async () => {
      const patch = {
        tax_enabled: document.getElementById('tax-enabled').checked ? 1 : 0,
        tax_show_on_pos: document.getElementById('tax-show-pos').checked ? 1 : 0,
        tax_rate: parseFloat(document.getElementById('tax-rate').value) || 0,
        tax_inclusive: document.getElementById('tax-inclusive').checked ? 1 : 0,
        vat_number: document.getElementById('vat-num').value.trim(),
        currency: document.getElementById('cur-symbol').value.trim(),
        currency_name: document.getElementById('cur-name').value.trim(),
        decimal_places: parseInt(document.getElementById('cur-dec').value) || 2,
        thousands_sep: document.getElementById('cur-sep').value
      };
      await API.saveSettings(patch, this.app.user);
      // Keep bookkeeping VAT in sync
      try {
        const bk = await API.getBookkeepingSettings();
        const cur = bk.data || {};
        await API.saveBookkeepingSettings({
          ...cur,
          vat_rate: patch.tax_rate,
          vat_registered: patch.tax_enabled ? 1 : 0
        }, this.app.user);
      } catch (_) { /* ignore */ }
      this.settings = { ...this.settings, ...patch };
      if (this.app) this.app.settings = { ...this.app.settings, ...patch };
      Utils.toast('Tax & currency saved (linked to bookkeeping)', 'success');
    });
  },

  async renderTaxHub(el) {
    const currency = this.settings?.currency || 'R';
    const from = this._taxFrom || Utils.daysAgo(30);
    const to = this._taxTo || Utils.today();
    const branchesRes = await API.getBranches();
    const branches = branchesRes.data || [];
    const viewBranch = this.app?.viewBranchId != null ? String(this.app.viewBranchId) : 'all';
    el.innerHTML = `<div class="admin-section"><h3>Tax Calculations</h3>
      <p class="muted">Per-sale tax breakdown, totals, and PDF download. Filter by branch and date range.</p>
      <div class="page-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select id="tax-hub-branch">
          <option value="all">All branches</option>
          ${branches.map((b) => `<option value="${b.id}" ${viewBranch === String(b.id) ? 'selected' : ''}>${Utils.escHtml(b.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-days="0">Today</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-days="7">7 days</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-days="30">30 days</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-months="6">6 months</button>
        <button type="button" class="btn btn-ghost btn-sm tax-preset" data-year="1">Year</button>
        <input type="date" id="tax-hub-from" value="${from}">
        <input type="date" id="tax-hub-to" value="${to}">
        <button class="btn btn-ghost" id="tax-hub-refresh">Refresh</button>
        <button class="btn btn-primary" id="tax-hub-pdf">Download PDF</button>
        <button class="btn btn-ghost" id="tax-hub-bookkeeping">Bookkeeping</button>
      </div>
      <div id="tax-hub-body"><p class="muted">Loading…</p></div>
    </div>`;

    const setRange = (fromDate, toDate) => {
      document.getElementById('tax-hub-from').value = fromDate;
      document.getElementById('tax-hub-to').value = toDate;
    };

    el.querySelectorAll('.tax-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const toDate = Utils.today();
        if (btn.dataset.days != null) {
          const d = Number(btn.dataset.days);
          setRange(d === 0 ? toDate : Utils.daysAgo(d), toDate);
        } else if (btn.dataset.months) {
          const d = new Date();
          d.setMonth(d.getMonth() - Number(btn.dataset.months));
          setRange(d.toISOString().slice(0, 10), toDate);
        } else if (btn.dataset.year) {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 1);
          setRange(d.toISOString().slice(0, 10), toDate);
        }
        load();
      });
    });

    const load = async () => {
      this._taxFrom = document.getElementById('tax-hub-from').value;
      this._taxTo = document.getElementById('tax-hub-to').value;
      const branchId = document.getElementById('tax-hub-branch').value;
      const body = document.getElementById('tax-hub-body');
      const taxRes = await API.getTaxSummary(this._taxFrom, this._taxTo, branchId === 'all' ? null : branchId);
      if (!taxRes.success) {
        body.innerHTML = `<p class="error-msg">${Utils.escHtml(taxRes.error || 'Failed to load')}</p>`;
        return;
      }
      const t = taxRes.data || {};
      const sales = t.sales || [];
      this._lastTaxReport = t;
      body.innerHTML = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0">
          <div class="card"><div class="card-body"><div class="muted">Sales count</div><strong>${t.salesCount || sales.length}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Gross sales</div><strong>${Utils.formatMoney(t.taxableSales || 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Excl. tax</div><strong>${Utils.formatMoney(t.salesExcl || 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Tax / VAT</div><strong>${Utils.formatMoney(t.outputVat ?? t.vat ?? 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">After tax</div><strong>${Utils.formatMoney(t.salesAfterTax != null ? t.salesAfterTax : ((t.taxableSales || 0) - (t.outputVat ?? t.vat ?? 0)), currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Input VAT (purchases)</div><strong>${Utils.formatMoney(t.inputVat || 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">Net VAT</div><strong>${Utils.formatMoney(t.netVat != null ? t.netVat : 0, currency)}</strong></div></div>
          <div class="card"><div class="card-body"><div class="muted">VAT rate</div><strong>${t.vatRate || 0}%</strong></div></div>
        </div>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr><th>Receipt</th><th>Date</th><th>Branch</th><th>Cashier</th><th>Excl. tax</th><th>Tax</th><th>Total</th></tr></thead>
          <tbody>
            ${sales.map((s) => `<tr>
              <td>${Utils.escHtml(s.receipt_number || '—')}</td>
              <td>${Utils.formatDateTime(s.created_at)}</td>
              <td>${Utils.escHtml(s.branch_name || '—')}</td>
              <td>${Utils.escHtml(s.cashier_name || '—')}</td>
              <td>${Utils.formatMoney(s.subtotal || 0, currency)}</td>
              <td>${Utils.formatMoney(s.tax_amount || 0, currency)}</td>
              <td><strong>${Utils.formatMoney(s.total || 0, currency)}</strong></td>
            </tr>`).join('') || '<tr><td colspan="7" class="muted">No sales in this period</td></tr>'}
          </tbody>
        </table></div></div>`;
    };

    document.getElementById('tax-hub-refresh')?.addEventListener('click', load);
    document.getElementById('tax-hub-branch')?.addEventListener('change', load);
    document.getElementById('tax-hub-bookkeeping')?.addEventListener('click', () => this.app?.navigate?.('bookkeeping'));
    document.getElementById('tax-hub-pdf')?.addEventListener('click', async () => {
      const t = this._lastTaxReport;
      if (!t) return Utils.toast('Refresh the report first', 'error');
      const title = `Tax report ${this._taxFrom} to ${this._taxTo}`;
      const headers = ['Receipt', 'Date', 'Branch', 'Cashier', 'Excl. tax', 'Tax', 'Total'];
      const bodyRows = (t.sales || []).map((s) => [
        s.receipt_number || '',
        Utils.formatDateTime(s.created_at),
        s.branch_name || '',
        s.cashier_name || '',
        Utils.formatMoney(s.subtotal || 0, currency),
        Utils.formatMoney(s.tax_amount || 0, currency),
        Utils.formatMoney(s.total || 0, currency)
      ]);
      bodyRows.push(['TOTALS', '', '', '', Utils.formatMoney(t.salesExcl || 0, currency), Utils.formatMoney(t.outputVat ?? t.vat ?? 0, currency), Utils.formatMoney(t.taxableSales || 0, currency)]);
      bodyRows.push(['Net VAT owed', '', '', '', '', Utils.formatMoney(t.netVat || 0, currency), '']);
      if (typeof Export?.toPDF === 'function') {
        await Export.toPDF(`tax-report-${this._taxFrom}.pdf`, title, headers, bodyRows, { shop_name: this.settings?.shop_name });
      } else if (typeof Export?.print === 'function') {
        await Export.print(title, headers, bodyRows, { shop_name: this.settings?.shop_name });
      } else {
        Utils.toast('PDF export not available on this device', 'error');
      }
    });
    await load();
  },

  async renderCashiersPanel(el) {
    const currency = this.settings?.currency || 'R';
    const from = this._cashierFrom || Utils.daysAgo(7);
    const to = this._cashierTo || Utils.today();
    el.innerHTML = `<div class="admin-section"><h3>Cashiers &amp; Managers</h3>
      <p class="muted">Create multiple managers and cashiers under <strong>Users</strong>. Here you see each cashier’s sales for the period.</p>
      <div class="page-toolbar" style="gap:8px;flex-wrap:wrap">
        <input type="date" id="cash-from" value="${from}">
        <input type="date" id="cash-to" value="${to}">
        <button class="btn btn-ghost" id="cash-refresh">Refresh</button>
        <button class="btn btn-primary" id="cash-goto-users">Manage users</button>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Sales</th><th>Subtotal</th><th>Tax</th><th>Total</th><th></th></tr></thead>
        <tbody id="cash-tbody"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
      </table></div></div>
      <div id="cash-detail" style="margin-top:16px"></div>
    </div>`;

    const load = async () => {
      this._cashierFrom = document.getElementById('cash-from').value;
      this._cashierTo = document.getElementById('cash-to').value;
      const res = await API.getCashierReport(this._cashierFrom, this._cashierTo);
      const rows = res.data || [];
      document.getElementById('cash-tbody').innerHTML = rows.map(c => `<tr>
        <td>${Utils.escHtml(c.full_name || '—')}</td>
        <td>${Utils.escHtml(c.username || '—')}</td>
        <td>${Utils.roleTag?.(c.role) || c.role || '—'}</td>
        <td>${c.sales_count || 0}</td>
        <td>${Utils.formatMoney(c.subtotal || 0, currency)}</td>
        <td>${Utils.formatMoney(c.tax_total || 0, currency)}</td>
        <td><strong>${Utils.formatMoney(c.total || 0, currency)}</strong></td>
        <td><button class="btn btn-sm btn-ghost cash-drill" data-id="${c.user_id}" data-name="${Utils.escHtml(c.full_name || '')}">Details</button></td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">No cashier sales in this period</td></tr>';

      document.querySelectorAll('.cash-drill').forEach(btn => btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const detail = document.getElementById('cash-detail');
        detail.innerHTML = `<p class="muted">Loading sales for ${btn.dataset.name}…</p>`;
        const dRes = await API.getCashierSalesDetail(this._cashierFrom, this._cashierTo, id);
        const sales = dRes.data || [];
        detail.innerHTML = `<h4>${Utils.escHtml(btn.dataset.name)} — sales</h4>
          <div class="card"><div class="table-wrap"><table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Pay</th></tr></thead>
            <tbody>${sales.map(s => `<tr>
              <td>${Utils.escHtml(s.receipt_number || '—')}</td>
              <td>${Utils.formatDateTime(s.created_at)}</td>
              <td>${Utils.formatMoney(s.subtotal || 0, currency)}</td>
              <td>${Utils.formatMoney(s.tax_amount || 0, currency)}</td>
              <td>${Utils.formatMoney(s.total || 0, currency)}</td>
              <td>${Utils.escHtml(s.payment_method || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">No sales</td></tr>'}</tbody>
          </table></div></div>`;
      }));
    };

    document.getElementById('cash-refresh')?.addEventListener('click', load);
    document.getElementById('cash-goto-users')?.addEventListener('click', () => this.app?.navigate?.('users'));
    await load();
  },

  async renderSalesTargets(el) {
    const res = await API.getSalesTargets();
    const raw = res.data || {};
    const periodVal = (p) => {
      const v = raw[p];
      if (v != null && typeof v === 'object') return { amount: v.amount || 0, active: v.active !== false };
      return { amount: Number(v) || 0, active: p === 'daily' && Number(v) > 0 };
    };
    const periods = ['daily', 'weekly', 'monthly', 'yearly'];
    const t = Object.fromEntries(periods.map(p => [p, periodVal(p)]));
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Sales Targets</h3>
      <p class="muted">Set shop-wide sales targets. Toggle each period active/inactive. Cashiers only see an active daily target on POS.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        ${periods.map(p => `<div class="field">
          <label>${p.charAt(0).toUpperCase() + p.slice(1)} Target (${currency})</label>
          <input type="number" id="st-${p}" step="0.01" min="0" value="${t[p].amount}">
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:normal">
            <input type="checkbox" id="st-${p}-active" ${t[p].active ? 'checked' : ''}> Active
          </label>
        </div>`).join('')}
      </div>
      <button class="btn btn-primary" id="save-targets" style="margin-top:16px">Save Targets</button>
      </div></div></div>`;
    document.getElementById('save-targets').addEventListener('click', async () => {
      const payload = {};
      periods.forEach(p => {
        payload[p] = {
          amount: parseFloat(document.getElementById(`st-${p}`).value) || 0,
          active: document.getElementById(`st-${p}-active`).checked
        };
      });
      const r = await API.saveSalesTargets(payload, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Sales targets saved', 'success');
    });
  },

  async renderTopCustomers(el) {
    if (!['owner', 'manager'].includes(this.app.user?.role)) {
      el.innerHTML = '<div class="admin-section"><p class="muted">Top Customers is available to owner and manager only.</p></div>';
      return;
    }
    const from = this._tcFrom || Utils.monthStart();
    const to = this._tcTo || Utils.today();
    const limit = this._tcLimit || 50;
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Top Customers</h3>
      <p class="muted">Full admin control — edit customer details, delete, reward with gift cards, or message on WhatsApp.</p>
      <div style="display:flex;gap:8px;align-items:end;margin-bottom:12px;flex-wrap:wrap">
        <div class="field"><label>From</label><input type="date" id="tc-from" value="${from}"></div>
        <div class="field"><label>To</label><input type="date" id="tc-to" value="${to}"></div>
        <div class="field"><label>Top N</label><input type="number" id="tc-limit" min="5" max="200" value="${limit}" style="width:80px"></div>
        <button class="btn btn-primary" id="tc-load">Load</button>
        <button class="btn btn-ghost" id="tc-excel">Excel</button>
      </div>
      <div id="tc-table"><p class="muted">Loading…</p></div></div>`;
    const load = async () => {
      const f = document.getElementById('tc-from').value;
      const t = document.getElementById('tc-to').value;
      const lim = parseInt(document.getElementById('tc-limit').value, 10) || 50;
      this._tcFrom = f; this._tcTo = t; this._tcLimit = lim;
      const res = await API.getTopCustomers(f, t, lim);
      const rows = res.data || [];
      document.getElementById('tc-table').innerHTML = `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Customer</th><th>Phone</th><th>Email</th><th>Total Spent</th><th>Visits</th><th></th></tr></thead>
        <tbody>${rows.map((c, i) => `<tr>
          <td>${i + 1}</td>
          <td><strong>${Utils.escHtml(c.name)}</strong></td><td>${Utils.escHtml(c.phone || '—')}</td>
          <td>${Utils.escHtml(c.email || '—')}</td>
          <td>${Utils.formatMoney(c.total_spent, currency)}</td><td>${c.visits}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-primary tc-edit" data-id="${c.id}">Edit</button>
            <button class="btn btn-sm btn-ghost tc-gift" data-id="${c.id}" data-name="${Utils.escHtml(c.name)}" data-phone="${Utils.escHtml(c.phone || '')}">Gift Card</button>
            ${c.phone ? `<button class="btn btn-sm btn-success tc-wa" data-id="${c.id}" data-name="${Utils.escHtml(c.name)}" data-phone="${Utils.escHtml(c.phone)}">WhatsApp</button>` : ''}
            <button class="btn btn-sm btn-danger tc-del" data-id="${c.id}" data-name="${Utils.escHtml(c.name)}">Delete</button>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No customers in this period</td></tr>'}
        </tbody></table></div></div>`;
      document.querySelectorAll('.tc-edit').forEach(b => b.addEventListener('click', async () => {
        const detail = await API.getCustomer(parseInt(b.dataset.id, 10));
        const c = detail.data || rows.find(x => String(x.id) === b.dataset.id);
        if (!c) return Utils.toast('Customer not found', 'error');
        Utils.showModal('Edit Customer', `<div class="form-grid">
          <div class="field"><label>Name *</label><input id="tc-ed-name" value="${Utils.escHtml(c.name || '')}"></div>
          <div class="field"><label>Phone</label><input id="tc-ed-phone" value="${Utils.escHtml(c.phone || '')}"></div>
          <div class="field"><label>Email</label><input id="tc-ed-email" value="${Utils.escHtml(c.email || '')}"></div>
          <div class="field"><label>Address</label><input id="tc-ed-address" value="${Utils.escHtml(c.address || '')}"></div>
          <div class="field full"><label>Notes</label><textarea id="tc-ed-notes" rows="2">${Utils.escHtml(c.notes || '')}</textarea></div>
        </div>`, '<button class="btn btn-primary" id="tc-ed-save">Save Customer</button>');
        document.getElementById('tc-ed-save').addEventListener('click', async () => {
          const r = await API.saveCustomer({
            id: c.id,
            name: document.getElementById('tc-ed-name').value.trim(),
            phone: document.getElementById('tc-ed-phone').value.trim(),
            email: document.getElementById('tc-ed-email').value.trim(),
            address: document.getElementById('tc-ed-address').value.trim(),
            notes: document.getElementById('tc-ed-notes').value.trim()
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error || 'Could not save', 'error');
          Utils.hideModal();
          Utils.toast('Customer updated', 'success');
          load();
        });
      }));
      document.querySelectorAll('.tc-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm(`Delete customer "${b.dataset.name}"? Sales history stays; the customer profile is removed.`)) return;
        const r = await API.deleteCustomer(parseInt(b.dataset.id, 10), this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not delete', 'error');
        Utils.toast('Customer deleted', 'success');
        load();
      }));
      document.querySelectorAll('.tc-gift').forEach(b => b.addEventListener('click', async () => {
        const customerId = parseInt(b.dataset.id, 10);
        const customerName = b.dataset.name;
        const customerPhone = b.dataset.phone || '';
        const preset = { id: customerId, name: customerName, phone: customerPhone };
        Utils.showModal(`Gift Card — ${customerName}`, `
          <div class="field"><label>Amount *</label><input type="number" id="tc-gc-amount" step="0.01" min="1" value="100"></div>
          ${Utils.customerPickerHTML('tc-gc')}
          <div class="field"><label><input type="checkbox" id="tc-gc-wa" ${customerPhone ? 'checked' : ''} ${customerPhone ? '' : 'disabled'}> Send via WhatsApp</label></div>`,
          '<button class="btn btn-primary" id="tc-gc-save">Create Gift Card</button>');
        const custRes = await API.getCustomers({});
        const picker = Utils.bindCustomerPicker('tc-gc', custRes.data || [], preset);
        document.getElementById('tc-gc-save').addEventListener('click', async () => {
          const amount = parseFloat(document.getElementById('tc-gc-amount').value);
          const customer = picker.getSelected();
          if (!amount || amount <= 0) return Utils.toast('Enter a valid amount', 'error');
          const r = await API.createGiftCard({
            amount,
            customer_id: customer?.id || customerId,
            customer_phone: customer?.phone || customerPhone || null,
            notes: `Top customer reward — ${customer?.name || customerName}`
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error, 'error');
          Utils.hideModal();
          const code = r.data?.code || '';
          Utils.toast(`Gift card ${code} created`, 'success');
          const sendWa = document.getElementById('tc-gc-wa')?.checked && (customer?.phone || customerPhone);
          if (sendWa) {
            const waRes = await Utils.sendGiftCardWhatsApp(this.app, {
              phone: customer?.phone || customerPhone,
              customerName: customer?.name || customerName,
              customerId: customer?.id || customerId,
              code,
              amount
            });
            if (!waRes.success) Utils.toast(waRes.error || 'WhatsApp failed', 'error');
          }
        });
      }));
      document.querySelectorAll('.tc-wa').forEach(b => b.addEventListener('click', async () => {
        const r = await API.sendWhatsAppMessage({
          phone: b.dataset.phone, customer_id: parseInt(b.dataset.id, 10),
          recipient_name: b.dataset.name, customer_name: b.dataset.name,
          branch: this.settings.shop_name, message_type: 'thank_you', template_slug: 'thank_you'
        }, this.app.user);
        await Utils.deliverWhatsApp(r, b.dataset.phone);
      }));
      document.getElementById('tc-excel')?.addEventListener('click', async () => {
        await Export.toExcel(`top-customers-${f}-${t}.xlsx`, [{
          name: 'Top Customers',
          data: rows.map((c, i) => ({ Rank: i + 1, Name: c.name, Phone: c.phone || '', Email: c.email || '', Spent: c.total_spent, Visits: c.visits }))
        }]);
      });
    };
    document.getElementById('tc-load').addEventListener('click', load);
    await load();
  },

  async renderShifts(el) {
    const isAdmin = ['owner', 'manager'].includes(this.app.user?.role);
    const [shiftsRes, currentRes, shiftSettingsRes, openAllRes] = await Promise.all([
      API.getShifts(50),
      API.getOpenShift(this.app.user),
      API.getShiftSettings(),
      isAdmin ? API.getAllOpenShifts(this.app.user) : Promise.resolve({ data: [] })
    ]);
    const shifts = shiftsRes.data || [];
    const current = currentRes.data;
    const openAll = openAllRes.success ? (openAllRes.data || []) : [];
    const shiftSettings = shiftSettingsRes.success ? (shiftSettingsRes.data || {}) : (this.settings.shift_settings || {});
    const requiredRoles = shiftSettings.required_roles || ['cashier', 'manager', 'assistant_manager', 'owner'];
    const roleOptions = [
      { id: 'owner', label: 'Owner (Admin)' },
      { id: 'manager', label: 'Manager' },
      { id: 'supervisor', label: 'Supervisor' },
      { id: 'assistant_manager', label: 'Assistant Manager' },
      { id: 'cashier', label: 'Cashier' }
    ];
    const currency = this.settings.currency || 'R';

    const cashoutDeadline = shiftSettings.cashout_deadline_time || '22:00';
    const cashoutPenalty = shiftSettings.cashout_late_penalty ?? 0;
    const cashoutEnabled = shiftSettings.cashout_deadline_enabled !== false;
    el.innerHTML = `<div class="admin-section"><h3>Shift Management</h3>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <strong>Shift enforcement by role</strong>
        <p class="muted" style="margin:8px 0">Users with checked roles must open a shift on POS before taking sales. On re-login, they are prompted to continue their open shift.</p>
        <div class="form-grid" style="margin-top:8px">
          ${roleOptions.map(r => `<div class="field"><label><input type="checkbox" class="shift-role-req" data-role="${r.id}" ${requiredRoles.includes(r.id) ? 'checked' : ''}> ${r.label}</label></div>`).join('')}
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
        <strong>Cash-out deadline &amp; late charge</strong>
        <p class="muted" style="margin:8px 0">After this time, any open POS shift is auto-closed. Non-admin users (cashier, etc.) are charged the penalty on their next payroll/payslip. Owner/manager auto-close with no charge.</p>
        <div class="form-grid">
          <div class="field"><label><input type="checkbox" id="cashout-deadline-on" ${cashoutEnabled ? 'checked' : ''}> Enable cash-out deadline</label></div>
          <div class="field"><label>Closing / cash-out time</label><input type="time" id="cashout-deadline" value="${cashoutDeadline}"></div>
          <div class="field"><label>Late cash-out charge (${currency})</label><input type="number" id="cashout-penalty" min="0" step="0.01" value="${cashoutPenalty}"></div>
        </div>
        <button class="btn btn-primary btn-sm" id="save-shift-settings" style="margin-top:12px">Save Shift Settings</button>
      </div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <strong>Cashout WhatsApp notifications</strong>
        <p class="muted" style="margin:8px 0">When cashiers share cash-out reports via WhatsApp (POS or Operations), messages go to this number.</p>
        <div class="field"><label>Admin / Manager WhatsApp Number</label>
          <input id="shift-cashout-wa" value="${this.settings?.whatsapp_settings?.cashout_whatsapp_phone || ''}" placeholder="e.g. 082 123 4567">
          <small class="muted">Falls back to shop phone if empty: ${this.settings?.phone || '—'}</small></div>
        <button class="btn btn-primary btn-sm" id="save-cashout-wa" style="margin-top:12px">Save Cashout WhatsApp Number</button>
      </div></div>
      ${current ? `<div class="card" style="margin-bottom:16px;border-color:var(--success)"><div class="card-body">
        <strong>Your open shift</strong> — Started ${Utils.formatDateTime(current.opened_at)} — Float: ${Utils.formatMoney(current.opening_float, currency)}
        <button class="btn btn-warning btn-sm" id="close-shift" style="margin-left:12px">Close Shift</button>
      </div></div>` : `<div style="margin-bottom:16px">
        <button class="btn btn-success" id="open-shift">Open Shift</button></div>`}
      ${isAdmin && openAll.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="margin-top:0">All open till shifts</h4>
        <div class="table-wrap"><table><thead><tr><th>User</th><th>Opened</th><th>Float</th><th></th></tr></thead>
        <tbody>${openAll.map(sh => `<tr>
          <td>${Utils.escHtml(sh.user_name || '—')}</td>
          <td>${Utils.formatDateTime(sh.opened_at)}</td>
          <td>${Utils.formatMoney(sh.opening_float, currency)}</td>
          <td><button class="btn btn-sm btn-warning sh-force-close" data-id="${sh.id}">Force close</button></td>
        </tr>`).join('')}</tbody></table></div>
      </div></div>` : ''}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Opened</th><th>Closed</th><th>Sales</th><th>Cash</th><th>Card</th><th>Mobile</th><th>Cash Diff</th><th>Target</th><th>Status</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>${shifts.map(sh => {
          let actual = {};
          try { actual = JSON.parse(sh.actual_payments_json || '{}'); } catch {}
          const targetLabel = sh.daily_target > 0
            ? (sh.target_met ? '<span class="tag tag-ok">Met</span>' : Utils.formatMoney(sh.target_remaining, currency))
            : '—';
          return `<tr><td>${sh.user_name||'—'}</td><td>${Utils.formatDateTime(sh.opened_at)}</td>
          <td>${sh.closed_at ? Utils.formatDateTime(sh.closed_at) : '—'}</td>
          <td>${Utils.formatMoney(sh.total_sales, currency)}</td>
          <td>${Utils.formatMoney(sh.total_cash, currency)}${actual.cash != null ? `<br><small>Counted: ${Utils.formatMoney(actual.cash, currency)}</small>` : ''}</td>
          <td>${Utils.formatMoney(sh.total_card, currency)}</td>
          <td>${Utils.formatMoney(sh.mobile_sales ?? sh.total_mobile, currency)}</td>
          <td>${Utils.formatMoney(sh.cash_difference, currency)}</td>
          <td>${targetLabel}</td>
          <td><span class="tag ${sh.status==='open'?'tag-low':'tag-ok'}">${sh.status}</span></td>
          ${isAdmin ? `<td style="white-space:nowrap">
            ${sh.status === 'open' ? `<button class="btn btn-sm btn-warning sh-force-close" data-id="${sh.id}">Force close</button>` : ''}
            <button class="btn btn-sm btn-ghost sh-edit" data-id="${sh.id}">Edit</button>
            ${sh.status !== 'open' ? `<button class="btn btn-sm btn-danger sh-del" data-id="${sh.id}">Delete</button>` : ''}
          </td>` : ''}
          </tr>`;
        }).join('') || `<tr><td colspan="${isAdmin ? 11 : 10}" class="muted">No shifts yet</td></tr>`}
        </tbody></table></div></div></div>`;

    document.getElementById('save-shift-settings')?.addEventListener('click', async () => {
      const roles = [...document.querySelectorAll('.shift-role-req:checked')].map(cb => cb.dataset.role);
      if (!roles.length) return Utils.toast('Select at least one role', 'error');
      const r = await API.saveShiftSettings({
        required_roles: roles,
        cashout_deadline_enabled: !!document.getElementById('cashout-deadline-on')?.checked,
        cashout_deadline_time: document.getElementById('cashout-deadline')?.value || '22:00',
        cashout_late_penalty: parseFloat(document.getElementById('cashout-penalty')?.value) || 0
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      this.settings.shift_settings = r.data;
      this.app.settings = { ...this.app.settings, shift_settings: r.data };
      Utils.toast('Shift settings saved', 'success');
    });

    document.getElementById('save-cashout-wa')?.addEventListener('click', async () => {
      const phone = document.getElementById('shift-cashout-wa')?.value.trim() || '';
      const current = this.settings?.whatsapp_settings || {};
      const r = await API.saveWhatsAppSettings({ ...current, cashout_whatsapp_phone: phone }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const merged = r.data || { ...current, cashout_whatsapp_phone: phone };
      this.settings.whatsapp_settings = merged;
      this.app.settings = { ...this.app.settings, whatsapp_settings: merged };
      Utils.toast('Cashout WhatsApp number saved', 'success');
    });

    document.getElementById('open-shift')?.addEventListener('click', () => {
      Utils.showModal('Open Shift', '<div class="field"><label>Opening Float</label><input type="number" id="shift-float" step="0.01" value="0"></div>',
        '<button class="btn btn-success" id="confirm-open-shift">Open Shift</button>');
      document.getElementById('confirm-open-shift').addEventListener('click', async () => {
        const r = await API.openShift(parseFloat(document.getElementById('shift-float').value) || 0, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        this.renderShifts(el);
        Utils.toast('Shift opened', 'success');
      });
    });

    document.getElementById('close-shift')?.addEventListener('click', () => {
      Utils.showModal('Close Shift', `<div class="form-grid">
        <div class="field"><label>Cash Counted</label><input type="number" id="shift-counted" step="0.01"></div>
        <div class="field"><label>Closing Balance</label><input type="number" id="shift-closing" step="0.01"></div>
        <div class="field full"><label>Notes</label><input id="shift-notes"></div></div>`,
        '<button class="btn btn-warning" id="confirm-close-shift">Close Shift</button>');
      document.getElementById('confirm-close-shift').addEventListener('click', async () => {
        const r = await API.closeShift(current.id, {
          cash_counted: parseFloat(document.getElementById('shift-counted').value) || 0,
          closing_balance: parseFloat(document.getElementById('shift-closing').value) || 0,
          notes: document.getElementById('shift-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error, 'error');
        Utils.hideModal();
        const diff = r.data?.difference || 0;
        Utils.toast(`Shift closed. Cash difference: ${Utils.formatMoney(diff, currency)}`, diff === 0 ? 'success' : 'error');
        this.renderShifts(el);
      });
    });

    el.querySelectorAll('.sh-force-close').forEach(b => b.addEventListener('click', () => {
      Utils.showModal('Force close shift', `<p class="muted">Admin force-close for any open till. Leave cash blank to use expected cash (zero difference).</p>
        <div class="form-grid">
          <div class="field"><label>Cash counted (optional)</label><input type="number" id="fc-cash" step="0.01"></div>
          <div class="field"><label>Closing balance (optional)</label><input type="number" id="fc-close" step="0.01"></div>
          <div class="field full"><label>Notes</label><input id="fc-notes"></div>
        </div>`, '<button class="btn btn-warning" id="fc-go">Force close</button>');
      document.getElementById('fc-go').addEventListener('click', async () => {
        const cashVal = document.getElementById('fc-cash').value;
        const closeVal = document.getElementById('fc-close').value;
        const r = await API.forceCloseShift(parseInt(b.dataset.id, 10), {
          cash_counted: cashVal !== '' ? parseFloat(cashVal) : null,
          closing_balance: closeVal !== '' ? parseFloat(closeVal) : null,
          notes: document.getElementById('fc-notes').value.trim()
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not close', 'error');
        Utils.hideModal();
        Utils.toast('Shift force-closed', 'success');
        this.renderShifts(el);
      });
    }));
    el.querySelectorAll('.sh-edit').forEach(b => b.addEventListener('click', () => {
      const sh = shifts.find(x => String(x.id) === b.dataset.id);
      if (!sh) return;
      Utils.showModal('Edit shift', `<div class="form-grid">
        <div class="field"><label>Cash counted</label><input type="number" id="se-cash" step="0.01" value="${sh.cash_counted ?? ''}"></div>
        <div class="field"><label>Closing balance</label><input type="number" id="se-close" step="0.01" value="${sh.closing_balance ?? ''}"></div>
        <div class="field full"><label>Notes</label><textarea id="se-notes" rows="3">${Utils.escHtml(sh.notes || '')}</textarea></div>
      </div>`, '<button class="btn btn-primary" id="se-save">Save</button>');
      document.getElementById('se-save').addEventListener('click', async () => {
        const r = await API.updateShift(parseInt(b.dataset.id, 10), {
          cash_counted: document.getElementById('se-cash').value !== '' ? parseFloat(document.getElementById('se-cash').value) : null,
          closing_balance: document.getElementById('se-close').value !== '' ? parseFloat(document.getElementById('se-close').value) : null,
          notes: document.getElementById('se-notes').value
        }, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Could not update', 'error');
        Utils.hideModal();
        Utils.toast('Shift updated', 'success');
        this.renderShifts(el);
      });
    }));
    el.querySelectorAll('.sh-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this closed shift record? This cannot be undone.')) return;
      const r = await API.deleteShift(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Could not delete', 'error');
      Utils.toast('Shift deleted', 'success');
      this.renderShifts(el);
    }));
  },

  renderOperatingHours(el) {
    const oh = this.settings.operating_hours_settings || {};
    const days = oh.weekly || [
      { day: 0, name: 'Sunday', open: '08:00', close: '18:00', closed: false },
      { day: 1, name: 'Monday', open: '08:00', close: '18:00', closed: false },
      { day: 2, name: 'Tuesday', open: '08:00', close: '18:00', closed: false },
      { day: 3, name: 'Wednesday', open: '08:00', close: '18:00', closed: false },
      { day: 4, name: 'Thursday', open: '08:00', close: '18:00', closed: false },
      { day: 5, name: 'Friday', open: '08:00', close: '18:00', closed: false },
      { day: 6, name: 'Saturday', open: '08:00', close: '18:00', closed: false }
    ];
    el.innerHTML = `<div class="admin-section"><h3>Operating Hours — Weekly Schedule</h3>
      <p class="muted">Set open and close times for each day of the week. Cashiers see a countdown and hear the alert sound at closing time.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="oh-enabled" ${oh.enabled ? 'checked' : ''}> Enable closing countdown banner</label></div>
        <div class="field"><label>Warning Before Close (minutes)</label><input type="number" id="oh-warn" min="1" max="120" value="${oh.warn_minutes ?? 15}"></div>
        <div class="field full"><label><input type="checkbox" id="oh-alert" ${oh.alert_at_close !== false ? 'checked' : ''}> Alert & play sound when closing time is reached</label></div>
      </div>
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Day</th><th>Closed</th><th>Open</th><th>Close</th></tr></thead>
        <tbody>${days.map(d => `<tr>
          <td><strong>${d.name}</strong></td>
          <td><input type="checkbox" class="oh-closed" data-day="${d.day}" ${d.closed ? 'checked' : ''}></td>
          <td><input type="time" class="oh-open" data-day="${d.day}" value="${d.open || '08:00'}"></td>
          <td><input type="time" class="oh-close" data-day="${d.day}" value="${d.close || '18:00'}"></td>
        </tr>`).join('')}
        </tbody></table></div>
      <button class="btn btn-primary" id="save-operating" style="margin-top:16px">Save Operating Hours</button>
      </div></div></div>`;

    document.getElementById('save-operating').addEventListener('click', async () => {
      const weekly = days.map(d => ({
        day: d.day, name: d.name,
        closed: document.querySelector(`.oh-closed[data-day="${d.day}"]`)?.checked || false,
        open: document.querySelector(`.oh-open[data-day="${d.day}"]`)?.value || '08:00',
        close: document.querySelector(`.oh-close[data-day="${d.day}"]`)?.value || '18:00'
      }));
      const today = weekly.find(w => w.day === new Date().getDay()) || weekly[0];
      const data = {
        enabled: document.getElementById('oh-enabled').checked,
        open_time: today.open,
        close_time: today.close,
        warn_minutes: parseInt(document.getElementById('oh-warn').value, 10) || 15,
        alert_at_close: document.getElementById('oh-alert').checked,
        weekly
      };
      await API.saveJsonSetting('operating_hours_settings', data, this.app.user);
      this.settings.operating_hours_settings = data;
      this.app.settings = { ...this.app.settings, operating_hours_settings: data };
      this.app.startOperatingTimer?.();
      Utils.toast('Weekly operating hours saved', 'success');
    });
  },

  renderCashDrawer(el) {
    el.innerHTML = `<div class="admin-section"><h3>Cash Drawer Management</h3>
      <div class="card"><div class="card-body">
        <p>Opens the cash drawer via your receipt printer (ESC/POS kick command).</p>
        <p class="muted">Enable <strong>Open cash drawer after sale</strong> in Printer Setup to auto-open on cash payments.</p>
        <button class="btn btn-primary" id="open-drawer" style="margin-top:12px">Open Cash Drawer Now</button>
      </div></div></div>`;
    document.getElementById('open-drawer').addEventListener('click', async () => {
      const r = await API.openCashDrawer();
      Utils.toast(r.success ? 'Cash drawer opened' : (r.error || 'Could not open drawer'), r.success ? 'success' : 'error');
    });
  },

  async renderAnalytics(el) {
    el.innerHTML = `<div class="admin-section"><h3>Sales Analytics</h3>
      ${Utils.dateFilterHTML('admin-analytics-filter')}
      <div id="analytics-content" style="margin-top:16px"></div></div>`;
    const load = async (from, to) => {
      const [res, empRes, orderRes] = await Promise.all([
        API.getSalesAnalytics(from, to),
        API.getEmployeeReport(from, to).catch(() => ({ success: false })),
        API.getOrderTypeReport(from, to).catch(() => ({ success: false }))
      ]);
      const data = res.data || {};
      const staff = empRes.data || [];
      const orderTypes = orderRes.data?.by_type || [];
      const topStaff = staff[0];
      const currency = this.settings.currency || 'R';
      document.getElementById('analytics-content').innerHTML = `
        <div class="stats-grid">
          <div class="stat-card primary"><div class="label">Top Selling Staff</div>
            <div class="value" style="font-size:16px">${topStaff ? topStaff.full_name : '—'}</div>
            <small>${topStaff ? `${Utils.formatMoney(topStaff.revenue, currency)} · ${topStaff.sales_count || 0} sales` : 'No sales'}</small>
            <div style="margin-top:8px;display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" id="top-staff-pdf">PDF</button>
              <button class="btn btn-sm btn-ghost" id="top-staff-print">Print</button>
            </div>
          </div>
          <div class="stat-card"><div class="label">Top Products</div><div class="value" style="font-size:14px">${(data.byProduct||[]).slice(0,3).map(p=>p.product_name).join(', ')||'—'}</div></div>
        </div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Staff Sales Ranking</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Staff</th><th>Sales</th><th>Revenue</th></tr></thead>
        <tbody>${staff.map(s => `<tr><td>${s.full_name || '—'}</td><td>${s.sales_count || 0}</td>
          <td>${Utils.formatMoney(s.revenue, currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No data</td></tr>'}
        </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Best Sellers</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th><th>Profit</th></tr></thead>
        <tbody>${(data.byProduct||[]).map(p=>`<tr><td>${p.product_name}</td><td>${p.qty}</td>
          <td>${Utils.formatMoney(p.revenue,currency)}</td><td>${Utils.formatMoney(p.profit,currency)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No data</td></tr>'}
        </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>By Category</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Revenue</th></tr></thead>
        <tbody>${(data.byCategory||[]).map(c=>`<tr><td>${c.category||'Uncategorised'}</td><td>${Utils.formatMoney(c.revenue,currency)}</td></tr>`).join('')||'<tr><td colspan="2" class="muted">No data</td></tr>'}
        </tbody></table></div></div>
        <div class="card" style="margin-top:16px"><div class="card-header"><h3>Order Types (Delivery / Takeaway / Sit-in)</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Type</th><th>Orders</th><th>Revenue</th></tr></thead>
          <tbody>${orderTypes.map(row => `<tr><td>${({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online Order' }[row.order_type] || row.order_type || 'Unknown')}</td>
          <td>${row.orders}</td><td>${Utils.formatMoney(row.revenue, currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No order type data — enable at POS checkout</td></tr>'}
        </tbody></table></div></div>`;
      document.getElementById('top-staff-pdf')?.addEventListener('click', async () => {
        const headers = ['Staff', 'Sales Count', 'Revenue'];
        const rows = staff.map(s => [s.full_name || '—', String(s.sales_count || 0), Utils.formatMoney(s.revenue, currency)]);
        await Export.toPDF(`top-staff-${from}.pdf`, 'Top Selling Staff', headers, rows, { ...Utils.companyInfo(this.settings), dateRange: `${from} to ${to}` });
      });
      document.getElementById('top-staff-print')?.addEventListener('click', async () => {
        const headers = ['Staff', 'Sales Count', 'Revenue'];
        const rows = staff.map(s => [s.full_name || '—', String(s.sales_count || 0), Utils.formatMoney(s.revenue, currency)]);
        await Export.print('Top Selling Staff', headers, rows, { ...Utils.companyInfo(this.settings), dateRange: `${from} to ${to}` });
      });
    };
    Utils.bindDateFilter('admin-analytics-filter', load);
    load(Utils.monthStart(), Utils.today());
  },

  async renderInventory(el) {
    const res = await API.getInventoryStats();
    const inv = res.data || {};
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Inventory Dashboard</h3>
      <div class="stats-grid">
        <div class="stat-card primary"><div class="label">Total Stock Value</div><div class="value">${Utils.formatMoney(inv.totalValue, currency)}</div></div>
        <div class="stat-card warning"><div class="label">Low Stock</div><div class="value">${inv.lowStock||0}</div></div>
        <div class="stat-card danger"><div class="label">Out of Stock</div><div class="value">${inv.outOfStock||0}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card"><div class="card-header"><h3>Fast Moving</h3></div><div class="card-body">
          ${(inv.fastMoving||[]).map(p=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)">${p.product_name} — ${p.qty} sold</div>`).join('')||'<p class="muted">No data</p>'}
        </div></div>
        <div class="card"><div class="card-header"><h3>Slow Moving</h3></div><div class="card-body">
          ${(inv.slowMoving||[]).map(p=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)">${p.name} — ${p.stock_quantity} in stock</div>`).join('')||'<p class="muted">No data</p>'}
        </div></div>
      </div></div>`;
  },

  renderDiscounts(el) {
    const ds = this.settings.discount_settings || {};
    el.innerHTML = `<div class="admin-section"><h3>Discount Settings</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Max Discount %</label><input type="number" id="disc-max" value="${ds.max_percent||100}"></div>
        <div class="field"><label><input type="checkbox" id="disc-happy" ${ds.happy_hour?'checked':''}> Enable Happy Hour pricing</label></div>
        <div class="field"><label><input type="checkbox" id="disc-coupon" ${ds.coupon_codes?'checked':''}> Enable coupon codes</label></div>
        <div class="field"><label><input type="checkbox" id="disc-loyalty" ${ds.loyalty_discounts?'checked':''}> Enable loyalty discounts</label></div>
        <div class="field"><label><input type="checkbox" id="disc-employee" ${ds.employee_discounts?'checked':''}> Enable employee discounts</label></div>
      </div>
      <button class="btn btn-primary" id="save-discounts" style="margin-top:16px">Save Discount Settings</button>
      </div></div></div>`;
    document.getElementById('save-discounts').addEventListener('click', async () => {
      const dsSave = {
        max_percent: parseInt(document.getElementById('disc-max').value) || 100,
        happy_hour: document.getElementById('disc-happy').checked,
        coupon_codes: document.getElementById('disc-coupon').checked,
        loyalty_discounts: document.getElementById('disc-loyalty').checked,
        employee_discounts: document.getElementById('disc-employee').checked
      };
      await API.saveJsonSetting('discount_settings', dsSave, this.app.user);
      this.settings.discount_settings = dsSave;
      if (this.app) this.app.settings = { ...this.app.settings, discount_settings: dsSave };
      Utils.toast('Discount settings saved', 'success');
    });
  },

  renderLoyalty(el) {
    const ls = this.settings.loyalty_settings || {};
    const spend = ls.spend_amount ?? 10;
    const earned = ls.points_earned ?? 1;
    const minSale = ls.min_sale_total ?? 0;
    const pointValue = ls.point_value ?? 1;
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Loyalty Points</h3>
      <p class="muted">Customers earn points when selected on POS. Cashiers can redeem points at checkout to reduce the amount due.</p>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="loy-enabled" ${ls.enabled !== false ? 'checked' : ''}> Enable loyalty points</label></div>
        <div class="field"><label>Earn: spend amount (${currency})</label>
          <input type="number" id="loy-spend" step="0.01" min="0.01" value="${spend}"></div>
        <div class="field"><label>Points earned per spend block</label>
          <input type="number" id="loy-earned" step="1" min="1" value="${earned}"></div>
        <div class="field"><label>Point value when redeeming (${currency})</label>
          <input type="number" id="loy-value" step="0.01" min="0.01" value="${pointValue}"></div>
        <div class="field"><label>Minimum sale total (${currency})</label>
          <input type="number" id="loy-min" step="0.01" min="0" value="${minSale}"></div>
        <div class="field full">
          <div class="stat-card" style="margin-top:8px"><div class="label">Example</div>
            <div class="value" style="font-size:16px" id="loy-preview">—</div></div>
        </div>
      </div>
      <button class="btn btn-primary" id="save-loyalty" style="margin-top:16px">Save Loyalty Settings</button>
      </div></div></div>`;

    const updatePreview = () => {
      const s = parseFloat(document.getElementById('loy-spend').value) || 10;
      const p = parseInt(document.getElementById('loy-earned').value) || 1;
      const pv = parseFloat(document.getElementById('loy-value').value) || 1;
      const exampleTotal = 100;
      const pts = Math.floor((exampleTotal / s) * p);
      document.getElementById('loy-preview').textContent =
        `${currency}${exampleTotal} sale → earn ${pts} pts · 100 pts redeem = ${Utils.formatMoney(100 * pv, currency)}`;
    };
    ['loy-spend', 'loy-earned', 'loy-value'].forEach(id => document.getElementById(id).addEventListener('input', updatePreview));
    updatePreview();

    document.getElementById('save-loyalty').addEventListener('click', async () => {
      const data = {
        enabled: document.getElementById('loy-enabled').checked,
        spend_amount: parseFloat(document.getElementById('loy-spend').value) || 10,
        points_earned: parseInt(document.getElementById('loy-earned').value) || 1,
        point_value: parseFloat(document.getElementById('loy-value').value) || 1,
        min_sale_total: parseFloat(document.getElementById('loy-min').value) || 0
      };
      await API.saveJsonSetting('loyalty_settings', data, this.app.user);
      this.settings.loyalty_settings = data;
      Utils.toast('Loyalty settings saved', 'success');
    });
  },

  async renderCustomerRewards(el) {
    const res = await API.getCustomerRewardRules();
    const rules = res.data || [];
    const currency = this.settings.currency || 'R';
    el.innerHTML = `<div class="admin-section"><h3>Customer Gift Rewards</h3>
      <p class="muted">When a customer's total spend within a period reaches the threshold, a gift card is created automatically after checkout. Owner, manager, and assistant manager receive WhatsApp links to notify the customer.</p>
      <button class="btn btn-primary" id="reward-add" style="margin-bottom:12px">+ Add Rule</button>
      <div class="table-wrap"><table>
        <thead><tr><th>Enabled</th><th>Spend Threshold</th><th>Period (days)</th><th>Gift Amount</th><th>Card Expiry (days)</th><th>Notes</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr>
          <td>${r.enabled ? '✓' : '—'}</td>
          <td>${Utils.formatMoney(r.spend_threshold, currency)}</td>
          <td>${r.period_days}</td>
          <td>${Utils.formatMoney(r.gift_amount, currency)}</td>
          <td>${r.gift_expiry_days || 365}</td>
          <td>${Utils.escHtml(r.notes || '—')}</td>
          <td><button class="btn btn-sm btn-ghost reward-edit" data-id="${r.id}">Edit</button>
            <button class="btn btn-sm btn-danger reward-del" data-id="${r.id}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">No reward rules yet</td></tr>'}
        </tbody></table></div></div>`;

    const reload = () => this.renderCustomerRewards(el);
    document.getElementById('reward-add')?.addEventListener('click', () => this.showRewardRuleForm(null, reload));
    el.querySelectorAll('.reward-edit').forEach(b => b.addEventListener('click', () => {
      const rule = rules.find(r => r.id == b.dataset.id);
      if (rule) this.showRewardRuleForm(rule, reload);
    }));
    el.querySelectorAll('.reward-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this reward rule?')) return;
      const r = await API.deleteCustomerRewardRule(parseInt(b.dataset.id, 10), this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Rule deleted', 'success');
      reload();
    }));
  },

  showRewardRuleForm(rule, onSaved) {
    const currency = this.settings.currency || 'R';
    Utils.showModal(rule ? 'Edit Reward Rule' : 'New Reward Rule', `
      <div class="field"><label><input type="checkbox" id="rr-enabled" ${rule?.enabled !== 0 ? 'checked' : ''}> Rule enabled</label></div>
      <div class="field"><label>Spend threshold (${currency}) *</label>
        <input type="number" id="rr-threshold" step="0.01" min="1" value="${rule?.spend_threshold || 500}"></div>
      <div class="field"><label>Within (days) *</label>
        <input type="number" id="rr-days" min="1" value="${rule?.period_days || 30}"></div>
      <div class="field"><label>Gift card amount (${currency}) *</label>
        <input type="number" id="rr-gift" step="0.01" min="1" value="${rule?.gift_amount || 50}"></div>
      <div class="field"><label>Gift card valid for (days)</label>
        <input type="number" id="rr-expiry" min="1" value="${rule?.gift_expiry_days || 365}"></div>
      <div class="field"><label>Notes</label><textarea id="rr-notes" rows="2">${Utils.escHtml(rule?.notes || '')}</textarea></div>
      <p class="muted">Example: spend ${currency}500 within 30 days → auto ${currency}50 gift card.</p>`,
      '<button class="btn btn-primary" id="rr-save">Save Rule</button>');
    document.getElementById('rr-save')?.addEventListener('click', async () => {
      const data = {
        id: rule?.id,
        enabled: document.getElementById('rr-enabled').checked,
        spend_threshold: parseFloat(document.getElementById('rr-threshold').value),
        period_days: parseInt(document.getElementById('rr-days').value, 10),
        gift_amount: parseFloat(document.getElementById('rr-gift').value),
        gift_expiry_days: parseInt(document.getElementById('rr-expiry').value, 10),
        notes: document.getElementById('rr-notes').value.trim()
      };
      const r = await API.saveCustomerRewardRule(data, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.hideModal();
      Utils.toast('Reward rule saved', 'success');
      onSaved?.();
    });
  },

  renderImportExport(el) {
    el.innerHTML = `<div class="admin-section"><h3>Import & Export</h3>
      <div class="card"><div class="card-body">
        <h4>Import Products (CSV format: name, price, cost, barcode, sku, stock, unit)</h4>
        <textarea id="import-csv" rows="6" placeholder="Chicken Meal,80,48,123456,SKU001,25,each" style="width:100%;margin:12px 0;font-family:monospace"></textarea>
        <button class="btn btn-primary" id="import-products">Import Products</button>
        <hr style="margin:20px 0;border:none;border-top:1px solid var(--border)">
        <h4>Export</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-ghost" id="export-products">Export Products (Excel)</button>
          <button class="btn btn-ghost" id="export-customers">Export Customers (Excel)</button>
          <button class="btn btn-ghost" id="export-db">Export Database</button>
        </div>
      </div></div></div>`;

    document.getElementById('import-products').addEventListener('click', async () => {
      const text = document.getElementById('import-csv').value.trim();
      if (!text) return Utils.toast('Paste CSV data first', 'error');
      const rows = text.split('\n').map(line => {
        const [name, selling_price, buying_price, barcode, sku, stock_quantity, unit] = line.split(',').map(s => s.trim());
        return { name, selling_price, buying_price, barcode, sku, stock_quantity, unit };
      }).filter(r => r.name);
      const r = await API.importProducts(rows, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      const result = r.data;
      const count = typeof result === 'number' ? result : (result?.count || 0);
      Utils.toast(`Imported ${count} product(s)`, count ? 'success' : 'error');
      if (result?.errors?.length) Utils.toast(`Skipped: ${result.errors.slice(0, 2).join('; ')}`, 'error');
    });

    document.getElementById('export-products').addEventListener('click', async () => {
      const res = await API.getProducts();
      const products = res.data || [];
      Export.toExcel('products.xlsx', [{ name: 'Products', data: products.map(p => ({
        Name: p.name, Category: p.category_name, Price: p.selling_price, Cost: p.buying_price,
        Stock: p.stock_quantity, Barcode: p.barcode, SKU: p.sku, Unit: p.unit
      })) }]);
    });

    document.getElementById('export-customers').addEventListener('click', async () => {
      const res = await API.getCustomers();
      Export.toExcel('customers.xlsx', [{ name: 'Customers', data: (res.data||[]).map(c => ({
        Name: c.name, Phone: c.phone, Email: c.email, Balance: c.balance
      })) }]);
    });

    document.getElementById('export-db').addEventListener('click', () => API.backupExport(this.app.user));
  },

  renderPaymentMethods(el) {
    const pm = this.settings.payment_settings || {};
    const enabled = pm.enabled_methods || Utils.paymentTypes;
    const custom = pm.custom_methods || [];
    el.innerHTML = `<div class="admin-section"><h3>Payment Methods</h3>
      <p class="muted">Enable payment types available at checkout. Add custom methods (e.g. SnapScan, PayFast) — any string is accepted at sale completion.</p>
      <div class="card"><div class="card-body">
        <div class="form-grid">
          ${Utils.paymentTypes.map(t => `<div class="field"><label>
            <input type="checkbox" class="pm-enable" data-type="${t}" ${enabled.includes(t) ? 'checked' : ''}>
            ${Utils.paymentLabels[t]}</label></div>`).join('')}
          <div class="field full"><label><input type="checkbox" id="pm-mixed" ${pm.allow_mixed !== false ? 'checked' : ''}> Allow mixed payments (Card + Cash + EFT, etc.)</label></div>
          <div class="field full"><label><input type="checkbox" id="pm-giftcard" ${pm.giftcard_enabled !== false ? 'checked' : ''}> Enable Gift Card payments</label></div>
          <div class="field full"><label><input type="checkbox" id="pm-account" ${pm.account_enabled !== false ? 'checked' : ''}> Enable On Account (requires customer)</label></div>
          <div class="field full"><label><input type="checkbox" id="pm-eft" ${pm.eft_enabled !== false ? 'checked' : ''}> Enable EFT / Bank Transfer</label></div>
        </div>
        <h4 style="margin-top:20px">Custom Payment Methods</h4>
        <div id="custom-pm-list">${custom.map((m, i) => `
          <div class="form-grid custom-pm-row" data-i="${i}" style="margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px">
            <div class="field"><label>ID (no spaces)</label><input class="cpm-id" value="${m.id || ''}" placeholder="snapscan"></div>
            <div class="field"><label>Label</label><input class="cpm-label" value="${m.label || ''}" placeholder="SnapScan"></div>
            <div class="field" style="display:flex;align-items:flex-end"><label><input type="checkbox" class="cpm-enabled" ${m.enabled !== false ? 'checked' : ''}> Enabled</label></div>
            <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger cpm-remove">Remove</button></div>
          </div>`).join('') || '<p class="muted" id="custom-pm-empty">No custom methods yet</p>'}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-custom-pm" style="margin-top:8px">+ Add Custom Method</button>
        <button class="btn btn-primary" id="save-payments" style="margin-top:16px">Save Payment Settings</button>
      </div></div></div>`;

    document.getElementById('add-custom-pm').addEventListener('click', () => {
      const list = document.getElementById('custom-pm-list');
      document.getElementById('custom-pm-empty')?.remove();
      const row = document.createElement('div');
      row.className = 'form-grid custom-pm-row';
      row.style.cssText = 'margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px';
      row.innerHTML = `<div class="field"><label>ID (no spaces)</label><input class="cpm-id" placeholder="snapscan"></div>
        <div class="field"><label>Label</label><input class="cpm-label" placeholder="SnapScan"></div>
        <div class="field" style="display:flex;align-items:flex-end"><label><input type="checkbox" class="cpm-enabled" checked> Enabled</label></div>
        <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-sm btn-danger cpm-remove">Remove</button></div>`;
      list.appendChild(row);
      row.querySelector('.cpm-remove').addEventListener('click', () => row.remove());
    });
    el.querySelectorAll('.cpm-remove').forEach(b => b.addEventListener('click', () => b.closest('.custom-pm-row')?.remove()));

    document.getElementById('save-payments').addEventListener('click', async () => {
      const enabled_methods = [...document.querySelectorAll('.pm-enable:checked')].map(cb => cb.dataset.type);
      if (!enabled_methods.length) return Utils.toast('Enable at least one payment method', 'error');
      const custom_methods = [...document.querySelectorAll('.custom-pm-row')].map(row => ({
        id: row.querySelector('.cpm-id')?.value.trim().toLowerCase().replace(/\s+/g, '_'),
        label: row.querySelector('.cpm-label')?.value.trim(),
        enabled: row.querySelector('.cpm-enabled')?.checked !== false
      })).filter(m => m.id && m.label);
      const data = {
        enabled_methods: [...enabled_methods, ...custom_methods.map(m => m.id)],
        custom_methods,
        allow_mixed: document.getElementById('pm-mixed').checked,
        giftcard_enabled: document.getElementById('pm-giftcard').checked,
        account_enabled: document.getElementById('pm-account').checked,
        eft_enabled: document.getElementById('pm-eft').checked
      };
      await API.saveJsonSetting('payment_settings', data, this.app.user);
      this.settings.payment_settings = data;
      Utils.toast('Payment settings saved', 'success');
    });
  },

  renderCustomize(el) {
    const cu = this.settings.customization || {};
    const s = this.settings;
    const homeOpts = [
      ['pos', 'POS'], ['dashboard', 'Dashboard'], ['admin', 'Admin'], ['reports', 'Reports'],
      ['operations', 'Cash-Up & Ops'], ['staff', 'Staff Portal']
    ];
    el.innerHTML = `<div class="admin-section"><h3>Software Customization</h3>
      <p class="muted">Full control of branding, look, login, and day-to-day defaults. Changes apply after Save.</p>
      <div class="card"><div class="card-body">
      <h4 style="margin-top:0">Brand &amp; identity</h4>
      <div class="form-grid">
        <div class="field"><label>Shop / Business Name</label><input id="cu-name" value="${s.shop_name||''}"></div>
        <div class="field"><label>App Display Name <span class="muted">(login &amp; title)</span></label>
          <input id="cu-app-name" value="${s.app_display_name || s.shop_name || ''}" placeholder="Shown on login screen"></div>
        <div class="field"><label>Business Type</label>
          <select id="cu-type">${Utils.businessTypes.map(t =>
            `<option value="${t}" ${s.business_type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}</select></div>
        <div class="field"><label>Theme</label>
          <select id="cu-theme"><option value="light" ${s.theme==='light'?'selected':''}>Light</option>
          <option value="dark" ${s.theme==='dark'?'selected':''}>Dark</option></select></div>
        <div class="field"><label>Primary Button Color</label><input type="color" id="cu-color" value="${cu.button_color||'#2563eb'}"></div>
        <div class="field"><label>Accent Color</label><input type="color" id="cu-accent" value="${cu.accent_color||'#0ea5e9'}"></div>
        <div class="field"><label>Email</label><input id="cu-email" value="${s.email||''}"></div>
        <div class="field"><label>Website</label><input id="cu-website" value="${s.website||''}"></div>
        <div class="field"><label>Social Media</label><input id="cu-social" value="${s.social_media||''}"></div>
        <div class="field full"><label>Company Logo</label>
          <button class="btn btn-ghost" id="cu-logo-btn">Upload Logo</button>
          ${s.logo_path ? `<img id="cu-logo-preview" src="file://${s.logo_path.replace(/\\/g, '/')}" style="max-height:60px;margin-top:8px;border-radius:8px;display:block">` : ''}</div>
      </div>
      <h4 style="margin-top:24px">Login &amp; home</h4>
      <div class="form-grid">
        <div class="field full"><label>Login welcome message</label>
          <input id="cu-login-msg" value="${Utils.escHtml(cu.login_message || '')}" placeholder="e.g. Welcome to Happy’s Shop"></div>
        <div class="field"><label>Default page after login</label>
          <select id="cu-home">${homeOpts.map(([id, label]) =>
            `<option value="${id}" ${(cu.default_home_page || 'pos') === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field"><label>UI size scale</label>
          <select id="cu-scale">
            ${[['0.9','Small'],['1','Normal'],['1.1','Large'],['1.2','Extra large']].map(([v,l]) =>
              `<option value="${v}" ${String(cu.ui_scale || '1') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <h4 style="margin-top:24px">Layout &amp; behaviour</h4>
      <div class="form-grid">
        <div class="field full"><label><input type="checkbox" id="cu-compact" ${cu.compact_nav ? 'checked' : ''}> Compact sidebar</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-hide-emoji" ${cu.hide_nav_emojis ? 'checked' : ''}> Hide emojis in menu labels</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-sound" ${cu.sounds_enabled !== false ? 'checked' : ''}> Enable UI / checkout sounds</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-auto-print" ${cu.auto_print_receipt ? 'checked' : ''}> Auto-print receipt after sale</label></div>
        <div class="field full"><label><input type="checkbox" id="cu-confirm-void" ${cu.confirm_void !== false ? 'checked' : ''}> Confirm before void / large discount</label></div>
        <div class="field"><label>POS product grid columns</label>
          <input type="number" id="cu-pos-cols" min="2" max="8" value="${cu.pos_grid_columns || 4}"></div>
        <div class="field"><label>Low stock alert threshold</label>
          <input type="number" id="cu-low-stock" min="0" step="1" value="${cu.low_stock_threshold ?? 5}"></div>
        <div class="field"><label>Idle lock (minutes, 0 = off)</label>
          <input type="number" id="cu-idle" min="0" max="240" value="${cu.idle_lock_minutes ?? 0}"></div>
      </div>
      <button class="btn btn-primary" id="save-customize" style="margin-top:16px">Save Customization</button>
      </div></div></div>`;

    let logoPath = s.logo_path;
    const logoPreviewId = 'cu-logo-preview';
    document.getElementById('cu-logo-btn').addEventListener('click', async () => {
      const r = await API.selectImage('logo');
      if (r.success) {
        logoPath = r.path;
        let preview = document.getElementById(logoPreviewId);
        if (!preview) {
          preview = document.createElement('img');
          preview.id = logoPreviewId;
          preview.style.cssText = 'max-height:60px;margin-top:8px;border-radius:8px;display:block';
          document.getElementById('cu-logo-btn').after(preview);
        }
        preview.src = `file://${logoPath.replace(/\\/g, '/')}`;
        Utils.toast('Logo uploaded — click Save to apply', 'success');
      }
    });

    document.getElementById('save-customize').addEventListener('click', async () => {
      const bizType = document.getElementById('cu-type').value;
      await API.saveSettings({
        shop_name: document.getElementById('cu-name').value.trim(),
        app_display_name: document.getElementById('cu-app-name').value.trim() || document.getElementById('cu-name').value.trim(),
        business_type: bizType,
        theme: document.getElementById('cu-theme').value,
        email: document.getElementById('cu-email').value.trim(),
        website: document.getElementById('cu-website').value.trim(),
        social_media: document.getElementById('cu-social').value.trim(),
        logo_path: logoPath
      }, this.app.user);
      await API.saveJsonSetting('customization', {
        button_color: document.getElementById('cu-color').value,
        accent_color: document.getElementById('cu-accent').value,
        login_message: document.getElementById('cu-login-msg').value.trim(),
        default_home_page: document.getElementById('cu-home').value,
        ui_scale: parseFloat(document.getElementById('cu-scale').value) || 1,
        compact_nav: document.getElementById('cu-compact').checked,
        hide_nav_emojis: document.getElementById('cu-hide-emoji').checked,
        sounds_enabled: document.getElementById('cu-sound').checked,
        auto_print_receipt: document.getElementById('cu-auto-print').checked,
        confirm_void: document.getElementById('cu-confirm-void').checked,
        pos_grid_columns: parseInt(document.getElementById('cu-pos-cols').value, 10) || 4,
        low_stock_threshold: parseInt(document.getElementById('cu-low-stock').value, 10) || 0,
        idle_lock_minutes: parseInt(document.getElementById('cu-idle').value, 10) || 0
      }, this.app.user);
      if (bizType === 'restaurant') {
        const ps = this.settings.printer_settings || {};
        if (ps.kitchen_enabled !== true) {
          await API.saveJsonSetting('printer_settings', { ...ps, kitchen_enabled: true, kitchen_auto: ps.kitchen_auto !== false }, this.app.user);
        }
      }
      const settingsRes = await API.getSettingsParsed();
      if (settingsRes.success) {
        this.settings = settingsRes.data;
        this.app.settings = settingsRes.data;
        this.app.updateBranding();
        this.app.applyTheme();
        this.app.renderNav?.();
      }
      document.documentElement.setAttribute('data-theme', document.getElementById('cu-theme').value);
      Utils.toast('Customization saved', 'success');
    });
  },

  async renderBranchesSync(el) {
    const branchesRes = await API.getBranches();
    const branches = branchesRes.data || [];
    const activeRes = await API.getActiveBranch?.() || {};
    const active = activeRes.data || branches.find((b) => b.is_active) || branches[0] || { id: 1, name: 'Main Branch', code: 'MAIN' };
    const viewRes = await API.getViewBranch?.() || {};
    const view = viewRes.data || {};
    const currency = this.settings?.currency || 'R';
    const isOwner = this.app?.user?.role === 'owner';

    el.innerHTML = `<div class="admin-section"><h3>Branches</h3>
      <p class="muted">Each branch has its own manager (1), supervisor (1), cashiers (many), stock, sales, tax and expenses.
        Marketing agents can be shared. Use the top <strong>Branch</strong> filter to view one shop or all.</p>
      <div class="card" style="margin-bottom:12px"><div class="card-body">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
          <div><span class="muted">Till connected to:</span> <strong>${Utils.escHtml(active.name || '—')}</strong> <span class="tag tag-ok">Active till</span></div>
          <div><span class="muted">Admin viewing:</span> <strong>${view.view_all || view.view_branch_id == null ? 'All branches' : Utils.escHtml(view.branch?.name || '—')}</strong></div>
        </div>
      </div></div>
      <div class="card"><div class="card-body">
        <h4 style="margin-top:0">Your branches</h4>
        <div id="branch-list">${branches.map((b) => {
          const mgr = b.manager?.full_name || '— none —';
          const sup = b.supervisor?.full_name || '— none —';
          const cashiers = b.cashier_count != null ? b.cashier_count : (b.staff?.cashiers?.length || 0);
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
              <div>
                <strong>${Utils.escHtml(b.name)}</strong> <span class="muted">(${Utils.escHtml(b.code || '')})</span>
                ${b.id === active.id ? ' <span class="tag tag-ok">Till active</span>' : ''}
                ${b.is_active === 0 ? ' <span class="tag tag-out">Inactive</span>' : ''}
                <div class="muted" style="font-size:12px;margin-top:4px">
                  Manager: ${Utils.escHtml(mgr)} · Supervisor: ${Utils.escHtml(sup)} · Cashiers: ${cashiers}
                  · Sales today: ${Utils.formatMoney(b.sales_today || 0, currency)}
                  · Stock SKUs: ${b.stock_skus || 0}
                </div>
                ${b.address ? `<div class="muted" style="font-size:12px">${Utils.escHtml(b.address)}${b.phone ? ' · ' + Utils.escHtml(b.phone) : ''}</div>` : ''}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                <button type="button" class="btn btn-sm btn-ghost br-activate" data-id="${b.id}">Connect till</button>
                ${isOwner ? `<button type="button" class="btn btn-sm btn-ghost br-view" data-id="${b.id}">View data</button>
                <button type="button" class="btn btn-sm btn-ghost br-edit" data-id="${b.id}">Edit</button>` : ''}
              </div>
            </div>
          </div>`;
        }).join('') || '<p class="muted">No branches yet — add your first shop below.</p>'}</div>
        ${isOwner ? `<h4 style="margin-top:16px">Add / connect a branch</h4>
        <div class="form-grid">
          <div class="field"><label>Branch Name *</label><input id="br-name" placeholder="e.g. Sandton Mall"></div>
          <div class="field"><label>Branch Code *</label><input id="br-code" placeholder="e.g. SANDTON"></div>
          <div class="field"><label>Address</label><input id="br-address"></div>
          <div class="field"><label>Phone</label><input id="br-phone"></div>
        </div>
        <button type="button" class="btn btn-primary" id="br-add" style="margin-top:8px">Create Branch</button>
        <p class="muted" style="margin-top:8px;font-size:12px">After creating a branch: assign 1 manager + 1 supervisor + cashiers in <strong>Users</strong> (select that branch). Assign products to the branch on the Products page. Connect each till with <em>Connect till</em>.</p>` : ''}
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-body">
        <h4>Recipe file transfer</h4>
        <p class="muted" style="font-size:12px">Optional file export/import of recipe BOM between shops.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
          <button type="button" class="btn btn-ghost" id="sync-export-recipes">Export Recipes (file)</button>
          <button type="button" class="btn btn-ghost" id="sync-import-recipes">Import Recipes…</button>
        </div>
        <input type="file" id="sync-recipe-file" accept="application/json,.json" class="hidden">
      </div></div></div>`;

    document.getElementById('br-add')?.addEventListener('click', async () => {
      const name = document.getElementById('br-name').value.trim();
      const code = document.getElementById('br-code').value.trim();
      if (!name || !code) return Utils.toast('Name and code required', 'error');
      const r = await API.saveBranch({
        name, code,
        address: document.getElementById('br-address').value.trim(),
        phone: document.getElementById('br-phone').value.trim()
      }, this.app.user);
      if (!r.success) return Utils.toast(r.error, 'error');
      Utils.toast('Branch created — assign manager, supervisor & cashiers next', 'success');
      this.renderBranchesSync(el);
    });

    el.querySelectorAll('.br-activate').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await API.setActiveBranch(parseInt(btn.dataset.id, 10), this.app.user);
        if (r && r.success === false) return Utils.toast(r.error || 'Failed', 'error');
        Utils.toast('This till is now connected to that branch', 'success');
        this.app?.refreshBranchSwitcher?.();
        this.renderBranchesSync(el);
      });
    });

    el.querySelectorAll('.br-view').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await API.setViewBranch(parseInt(btn.dataset.id, 10), this.app.user);
        if (r && r.success === false) return Utils.toast(r.error || 'Failed', 'error');
        Utils.toast('Admin view filtered to this branch', 'success');
        this.app?.refreshBranchSwitcher?.();
        this.renderBranchesSync(el);
      });
    });

    el.querySelectorAll('.br-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const b = branches.find((x) => String(x.id) === String(btn.dataset.id));
        if (!b) return;
        Utils.showModal(`Edit branch — ${b.name}`, `
          <div class="form-grid">
            <div class="field"><label>Name</label><input id="be-name" value="${Utils.escHtml(b.name || '')}"></div>
            <div class="field"><label>Code</label><input id="be-code" value="${Utils.escHtml(b.code || '')}"></div>
            <div class="field"><label>Address</label><input id="be-address" value="${Utils.escHtml(b.address || '')}"></div>
            <div class="field"><label>Phone</label><input id="be-phone" value="${Utils.escHtml(b.phone || '')}"></div>
            <div class="field full"><label><input type="checkbox" id="be-active" ${b.is_active !== 0 ? 'checked' : ''}> Active</label></div>
          </div>`,
          '<button class="btn btn-primary" id="be-save">Save</button>');
        document.getElementById('be-save')?.addEventListener('click', async () => {
          const r = await API.saveBranch({
            id: b.id,
            name: document.getElementById('be-name').value.trim(),
            code: document.getElementById('be-code').value.trim(),
            address: document.getElementById('be-address').value.trim(),
            phone: document.getElementById('be-phone').value.trim(),
            is_active: document.getElementById('be-active').checked
          }, this.app.user);
          if (!r.success) return Utils.toast(r.error || 'Save failed', 'error');
          Utils.hideModal();
          Utils.toast('Branch updated', 'success');
          this.renderBranchesSync(el);
        });
      });
    });

    document.getElementById('sync-export-recipes')?.addEventListener('click', async () => {
      const r = await API.recipeExportBundle(this.app.user);
      if (!r.success) return Utils.toast(r.error || 'Export failed', 'error');
      const bytes = Array.from(new TextEncoder().encode(JSON.stringify(r.data, null, 2)));
      await API.saveFile(`recipe-bundle-${Utils.today()}.json`, [{ name: 'JSON', extensions: ['json'] }], bytes);
      Utils.toast(`Exported ${(r.data?.meals || []).length} meals`, 'success');
    });
    document.getElementById('sync-import-recipes')?.addEventListener('click', () => {
      document.getElementById('sync-recipe-file')?.click();
    });
    document.getElementById('sync-recipe-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const bundle = JSON.parse(await file.text());
        const r = await API.recipeImportBundle(bundle, this.app.user);
        if (!r.success) return Utils.toast(r.error || 'Import failed', 'error');
        Utils.toast(`Imported ${r.data?.imported || 0} of ${r.data?.total || 0} meals`, 'success');
      } catch (err) {
        Utils.toast(err.message || 'Invalid recipe file', 'error');
      }
      e.target.value = '';
    });
  },

  renderDevice(el) {
    const ds = this.settings.device_settings || {};
    const devId = ds.device_id || Utils.getDeviceId();
    el.innerHTML = `<div class="admin-section"><h3>Device Settings</h3>
      <div class="card"><div class="card-body"><div class="form-grid">
        <div class="field"><label>Computer / Device Name</label><input id="dev-name" value="${ds.device_name||''}"></div>
        <div class="field"><label>Tablet Name</label><input id="dev-tablet" value="${ds.tablet_name||''}"></div>
        <div class="field"><label>Device ID</label><input id="dev-id" value="${devId}" readonly></div>
        <div class="field"><label>Software Version</label><input value="2.1.8" readonly></div>
        <div class="field full"><label>Backup Location</label><input id="dev-backup" value="${ds.backup_location||'Default (AppData)'}"></div>
        <div class="field"><label><input type="checkbox" id="dev-active" ${ds.activated!==false?'checked':''}> POS Activated</label></div>
      </div>
      <button class="btn btn-primary" id="save-device" style="margin-top:16px">Save Device Settings</button>
      </div></div></div>`;
    document.getElementById('save-device').addEventListener('click', async () => {
      const deviceId = document.getElementById('dev-id').value || Utils.getDeviceId();
      await API.saveJsonSetting('device_settings', {
        device_name: document.getElementById('dev-name').value.trim(),
        tablet_name: document.getElementById('dev-tablet').value.trim(),
        device_id: deviceId,
        backup_location: document.getElementById('dev-backup').value.trim(),
        activated: document.getElementById('dev-active').checked
      }, this.app.user);
      Utils.saveLocalDeviceSettings({ device_id: deviceId });
      Utils.toast('Device settings saved', 'success');
    });
  },

  renderBackup(el) {
    const bs = this.settings.backup_settings || {};
    const mobileHint = window.__SHOP_POS_MOBILE__
      ? '<p class="muted" id="bk-folder">Backup folder: Documents/ShopPOS/backups/</p>'
      : '';
    el.innerHTML = `<div class="admin-section"><h3>Backup & Restore</h3>
      <div class="card"><div class="card-body">
        <p class="muted">Last backup: ${this.settings.last_backup ? Utils.formatDateTime(this.settings.last_backup) : 'Never'}</p>
        ${mobileHint}
        <p class="muted" style="margin-top:8px">A full <strong>.db backup</strong> includes all products, sales, staff, settings, quotes, payroll, and customer data. Store backups safely off this device.</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;max-width:320px">
          <button class="btn btn-primary" id="adm-backup">Create Backup</button>
          <button class="btn btn-warning" id="adm-restore">Restore Backup</button>
          <button class="btn btn-ghost" id="adm-export">Export Database File</button>
        </div>
        <p class="muted" style="margin-top:12px;font-size:12px;color:var(--danger)"><strong>Restore warning:</strong> Restoring replaces ALL current data with the backup file. Export or backup first if unsure.</p>
        <div class="form-grid" style="margin-top:24px">
          <div class="field"><label><input type="checkbox" id="bk-auto" ${bs.auto_backup?'checked':''}> Automatic daily backup</label></div>
          <div class="field"><label><input type="checkbox" id="bk-remind" ${bs.reminder!==false?'checked':''}> Backup reminder</label></div>
        </div>
        <button class="btn btn-primary" id="save-backup-settings" style="margin-top:12px">Save Backup Settings</button>
      </div></div>
      <div class="card" style="margin-top:16px;border-color:var(--warning)"><div class="card-body">
        <h4 style="color:var(--warning)">Clear Selected Data</h4>
        <p class="muted">Choose what to wipe. <strong>Kept:</strong> products, categories, customers, suppliers, employees, users, and shop settings.</p>
        <p class="muted"><strong>Before clearing:</strong> A safety backup is created automatically. Owner password required.</p>
        <div id="clear-cats" class="form-grid" style="margin-top:12px">
          <div class="field full"><label><input type="checkbox" id="clear-cat-all"> Select all operational data</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="sales_orders"> POS sales &amp; orders</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="returns"> Returns / refunds</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="quotes_layby"> Quotes, lay-bye &amp; gift activity</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="customer_activity"> Loyalty &amp; credit ledger</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="cash_shifts"> Shifts, cash-up &amp; cash drops</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="stock_purchasing"> Stock moves, counts, waste &amp; POs</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="expenses_books"> Expenses &amp; bookkeeping txns</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="attendance_payroll"> Attendance &amp; payroll runs</label></div>
          <div class="field"><label><input type="checkbox" class="clear-cat" value="notifications_audit"> Notifications &amp; audit logs</label></div>
        </div>
        <button class="btn btn-warning" id="adm-clear-ops" style="margin-top:12px">Clear Selected Data</button>
      </div></div>
      <div class="card" style="margin-top:16px;border-color:var(--danger)"><div class="card-body">
        <h4 style="color:var(--danger)">Danger Zone — Delete Business</h4>
        <p class="muted">Permanently erase all data and accounts, then register a new business from scratch. Requires your Private Recovery Phrase.</p>
        <p class="muted"><strong>Tip:</strong> Export or backup your database first if you may need this data later.</p>
        <button class="btn btn-danger" id="adm-factory-reset" style="margin-top:12px">Delete Business & Start Over</button>
      </div></div></div>`;

    document.getElementById('adm-backup').addEventListener('click', async () => {
      const r = await API.backupCreate(this.app.user);
      if (r.success) Utils.toast(r.path ? `Backup saved to ${r.path}` : 'Backup saved!', 'success');
      else if (!r.cancelled) Utils.toast(r.error || 'Backup failed', 'error');
    });
    document.getElementById('adm-restore').addEventListener('click', async () => {
      if (!confirm('Restore will replace ALL data (products, sales, staff, settings). Continue?')) return;
      if (!confirm('Are you absolutely sure? This cannot be undone without another backup.')) return;
      const r = await API.backupRestore(this.app.user);
      if (r.success) { Utils.toast('Restored. Restarting…', 'success'); setTimeout(() => location.reload(), 1500); }
      else Utils.toast(r.error || 'Restore failed', 'error');
    });
    document.getElementById('adm-export').addEventListener('click', () => API.backupExport(this.app.user));
    document.getElementById('save-backup-settings').addEventListener('click', async () => {
      await API.saveJsonSetting('backup_settings', {
        auto_backup: document.getElementById('bk-auto').checked,
        reminder: document.getElementById('bk-remind').checked
      }, this.app.user);
      Utils.toast('Backup settings saved', 'success');
    });
    document.getElementById('adm-factory-reset').addEventListener('click', () => {
      this.app.showFactoryResetModal(true);
    });
    if (window.__SHOP_POS_MOBILE__) {
      API.getBackupInfo().then(r => {
        if (r.success && r.data?.folder) {
          const elFolder = document.getElementById('bk-folder');
          if (elFolder) elFolder.textContent = `Backup folder: ${r.data.folder}`;
        }
      }).catch(() => {});
    }
    document.getElementById('clear-cat-all')?.addEventListener('change', (e) => {
      el.querySelectorAll('.clear-cat').forEach((c) => { c.checked = e.target.checked; });
    });
    document.getElementById('adm-clear-ops').addEventListener('click', () => {
      if (this.app.user?.role !== 'owner') {
        Utils.toast('Only the owner can clear operational data', 'error');
        return;
      }
      const selected = [...el.querySelectorAll('.clear-cat:checked')].map((c) => c.value);
      if (!selected.length) {
        Utils.toast('Select at least one data type to clear', 'error');
        return;
      }
      const labels = selected.map((v) => el.querySelector(`.clear-cat[value="${v}"]`)?.parentElement?.textContent?.trim() || v);
      Utils.showModal('Clear Selected Data', `
        <p class="muted" style="margin-bottom:12px"><strong>Warning:</strong> This permanently deletes:</p>
        <ul style="margin:0 0 12px;padding-left:18px">${labels.map((l) => `<li>${Utils.escHtml(l)}</li>`).join('')}</ul>
        <p class="muted" style="margin-bottom:12px">Products, customers, suppliers, employees, users, and settings stay. An automatic backup is created first.</p>
        <div class="field"><label>Owner Password</label><input type="password" id="clear-ops-pw" autocomplete="current-password"></div>
        <div class="field full"><label><input type="checkbox" id="clear-ops-confirm"> I understand this cannot be undone without restoring the auto-backup</label></div>
      `, '<button class="btn btn-warning" id="clear-ops-go">Clear Selected Data</button>');
      document.getElementById('clear-ops-go').addEventListener('click', async () => {
        if (!document.getElementById('clear-ops-confirm').checked) {
          return Utils.toast('Please confirm you understand the consequences', 'error');
        }
        const pw = document.getElementById('clear-ops-pw').value;
        if (!pw) return Utils.toast('Password required', 'error');
        const r = await API.clearOperationalData(pw, this.app.user, selected);
        if (!r.success) return Utils.toast(r.error || 'Clear failed', 'error');
        Utils.hideModal();
        Utils.toast(`Selected data cleared. Backup: ${r.data?.backup_path || 'saved'}`, 'success');
        setTimeout(() => location.reload(), 2000);
      });
    });
  },

  async handleAdminSearch(query) {
    const dropdown = document.getElementById('admin-search-results');
    if (!dropdown) return;
    if (!query || query.length < 2) { dropdown.classList.add('hidden'); return; }
    const q = query.toLowerCase();
    const currency = this.settings?.currency || 'R';
    let html = '';

    const sections = (this.sections || []).filter(s =>
      s.label.toLowerCase().includes(q) && Utils.canAccessAdminSection(this.app.user, s.id)
    );
    if (sections.length) {
      html += '<div class="search-group"><h4>Admin Sections</h4>' +
        sections.map(s => `<div class="search-item" data-action="admin-section" data-section="${s.id}">${s.label}</div>`).join('') + '</div>';
    }

    const res = await API.globalSearch(query);
    const data = res.data || {};
    if (data.products?.length && Utils.canAccess(this.app.user, 'products')) {
      html += '<div class="search-group"><h4>Products</h4>' +
        data.products.map(p => `<div class="search-item" data-action="page" data-page="products">${p.name} — ${Utils.formatMoney(p.selling_price, currency)}</div>`).join('') + '</div>';
    }
    if (data.employees?.length && Utils.canAccessAdminSection(this.app.user, 'staffhr')) {
      html += '<div class="search-group"><h4>Employees</h4>' +
        data.employees.map(e => `<div class="search-item" data-action="admin-section" data-section="staffhr">${e.full_name}${e.employee_code ? ` (${e.employee_code})` : ''}${e.phone ? ` — ${e.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.combos?.length && Utils.canAccessAdminSection(this.app.user, 'combos')) {
      html += '<div class="search-group"><h4>Combos</h4>' +
        data.combos.map(c => `<div class="search-item" data-action="admin-section" data-section="combos">${c.name}</div>`).join('') + '</div>';
    }
    if (data.giftcards?.length && Utils.canAccess(this.app.user, 'giftcards')) {
      html += '<div class="search-group"><h4>Gift Cards</h4>' +
        data.giftcards.map(g => `<div class="search-item" data-action="page" data-page="giftcards"><code>${g.code}</code> — ${g.customer_name || '—'}</div>`).join('') + '</div>';
    }
    if (data.laybyes?.length && Utils.canAccess(this.app.user, 'layby')) {
      html += '<div class="search-group"><h4>Lay-Bye</h4>' +
        data.laybyes.map(l => `<div class="search-item" data-action="page" data-page="layby">${l.layby_number || 'Layby'} — ${l.customer_name || '—'}</div>`).join('') + '</div>';
    }
    if (data.categories?.length && Utils.canAccess(this.app.user, 'categories')) {
      html += '<div class="search-group"><h4>Categories</h4>' +
        data.categories.map(c => `<div class="search-item" data-action="page" data-page="categories">${c.name}</div>`).join('') + '</div>';
    }
    if (data.quotes?.length && Utils.canAccess(this.app.user, 'quotes')) {
      html += '<div class="search-group"><h4>Quotations</h4>' +
        data.quotes.map(qt => `<div class="search-item" data-action="page" data-page="quotes">${qt.quote_number}</div>`).join('') + '</div>';
    }
    if (data.donations?.length && Utils.canAccess(this.app.user, 'bookkeeping')) {
      html += '<div class="search-group"><h4>Donations</h4>' +
        data.donations.map(d => `<div class="search-item" data-action="bookkeeping-tab" data-tab="donations">${d.donation_number || 'Donation'} — ${d.recipient_org || 'Unknown'}</div>`).join('') + '</div>';
    }
    if (data.customers?.length && Utils.canAccess(this.app.user, 'customers')) {
      html += '<div class="search-group"><h4>Customers</h4>' +
        data.customers.map(c => `<div class="search-item" data-action="page" data-page="customers">${c.name}${c.phone ? ` — ${c.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.suppliers?.length && Utils.canAccess(this.app.user, 'suppliers')) {
      html += '<div class="search-group"><h4>Suppliers</h4>' +
        data.suppliers.map(s => `<div class="search-item" data-action="page" data-page="suppliers">${s.name}${s.phone ? ` — ${s.phone}` : ''}</div>`).join('') + '</div>';
    }
    if (data.receipts?.length && Utils.canAccess(this.app.user, 'pos')) {
      html += '<div class="search-group"><h4>Receipts</h4>' +
        data.receipts.map(r => `<div class="search-item" data-action="receipt" data-id="${r.receipt_number}">${r.receipt_number} — ${Utils.formatMoney(r.total, currency)}</div>`).join('') + '</div>';
    }
    if (data.settings?.length) {
      html += '<div class="search-group"><h4>Settings</h4>' +
        data.settings.filter(s => Utils.canAccessAdminSection(this.app.user, s.section)).map(s =>
          `<div class="search-item" data-action="admin-section" data-section="${s.section}">${s.label}: ${s.value}</div>`).join('') + '</div>';
    }
    // Also surface main-app panels this role can open (scoped)
    const navHits = (this.app.navItems || []).filter(item => {
      const label = item.label.replace(/^[^\w]+/, '').toLowerCase();
      return (label.includes(q) || item.id.includes(q)) && Utils.canAccess(this.app.user, item.id);
    }).slice(0, 10);
    if (navHits.length) {
      html += '<div class="search-group"><h4>App Pages</h4>' +
        navHits.map(f => `<div class="search-item" data-action="page" data-page="${f.id}">${f.label}</div>`).join('') + '</div>';
    }

    dropdown.innerHTML = html || '<div class="search-group"><p class="muted">No results</p></div>';
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('[data-action="admin-section"]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        const section = el.dataset.section;
        if (!Utils.canAccessAdminSection(this.app.user, section)) return;
        this.section = section;
        document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === section));
        this.toggleOpsComplianceLayout(section === 'opscompliance');
        this.renderSection(document.getElementById('admin-content'));
      });
    });
    dropdown.querySelectorAll('[data-action="page"]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        if (el.dataset.page === 'recipe') return this.app.openRecipeProduction({ fromApp: true });
        if (Utils.canAccess(this.app.user, el.dataset.page)) this.app.navigate(el.dataset.page);
      });
    });
    dropdown.querySelectorAll('[data-action="bookkeeping-tab"]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        this.app.navigateToBookkeepingTab(el.dataset.tab);
      });
    });
    dropdown.querySelectorAll('[data-action="receipt"]').forEach(el => {
      el.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        dropdown.classList.add('hidden');
        const r = await API.getSaleByReceipt(el.dataset.id);
        if (r.success && r.data) {
          Utils.showModal(`Receipt ${r.data.receipt_number}`, `
            <p><strong>Total:</strong> ${Utils.formatMoney(r.data.total, currency)}</p>
            <p><strong>Date:</strong> ${Utils.formatDateTime(r.data.created_at)}</p>
            <p><strong>Cashier:</strong> ${r.data.cashier_name || '—'}</p>`,
            '<button class="btn btn-primary" id="search-receipt-close">Close</button>');
          document.getElementById('search-receipt-close')?.addEventListener('click', Utils.hideModal);
        } else Utils.toast('Receipt not found', 'error');
      });
    });
  }
};
window.AdminPage = AdminPage;
